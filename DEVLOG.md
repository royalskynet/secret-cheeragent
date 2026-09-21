# DEVLOG

接手用的開發日誌。記「為什麼這樣訂」與「量過什麼」，不重複 README / SKILL.md 已有的說明。
倒序，最新在上。

---

## 2026-09-21 — 額度改滾動視窗、注入端加最小間隔（`f696e45`，已 push）

### 症狀

2026-09-20 全天 log：

```
01:28:13 injected 36t
01:28:17 injected 35t      ← 相隔 4 秒
01:31:48 injected_orphan 37t → used 108 / daily_token_budget 96
07:55 起 skipped_budget_exhausted ×332（全天靜音 14h）
```

### 兩個獨立根因

1. **暴力切線**：`lib/budget.js` 的 `todayStr()` 取 **UTC** 日期，`read()` 一旦 `data.date !== todayStr()`
   就把 `used_tokens` 歸零。使用者在 GMT+8 → 額度在當地 **08:00**（剛好開工）重置，中午前燒光，之後全天靜音。
   額度重置點與作息綁死，是設計缺陷不是調參問題。
2. **burst 攔在錯的那一端**：`burstMultiplier()` 只在 capture（Stop hook，**生產端**）衰減擲骰機率，
   但佇列把生產與消費解耦了 —— 已經排進佇列的 item，在**消費端** `canInject()` 完全沒有最小間隔檢查，
   會被連續幾個 PreToolUse 連發（上例 4 秒兩發）。
   **通則：有佇列時，節流必須放在消費點，放生產點等於沒放。**

### 修法

- `read()` 改滾動視窗：剔除 `recent_injections` 中早於 `now - budget_window_hours` 的項，
  `used_tokens` 改為**衍生值**（trim 後求和），不再獨立累加、不再切日。舊檔的 `used_tokens` 一律忽略，自癒。
- `canInject()` 在額度檢查**之前**加 `min_inject_interval_minutes`（預設 30）閘。
  呼叫端本來就寫 `log({ action: 'skipped_' + reason })`，因此自動多出 `skipped_min_interval`，免改呼叫端。
- `lib/paths.js` 加 `CHEER_STATE_DIR` 環境變數覆蓋（僅為測試隔離，一行）。
- `test/budget.test.js`：純 `node:assert`，無框架，`CHEER_STATE_DIR` 指向 `$TMPDIR`。

### 驗收（09-21 實測）

- `skipped_min_interval` 有出現，且帶 `note: "orphan not consumed, kept in queue"`（未消費就沒扣件，正確）。
- 注入間隔 91 分 / 54 分；每 2h 桶注入數 1 與 2（上限 4）。
- `skipped_budget_exhausted` 從 399 降到 10，且 10 筆全部早於 01:27Z（舊邏輯殘留）。

### 已知小瑕疵（未修）

`cfg.min_inject_interval_minutes || 30` 用 `||`，所以設 `0` 無法關閉間隔（會 fallback 成 30）。
要可關就得改 `??`。維持現狀是為了跟同檔其他 config 讀法一致。

---

## 2026-09-21 — 診斷但尚未修：鼓勵被守則句擠掉 + 舊 orphan 餓死

兩條都已記入 fixindex（9278 / 9279），工單寫好但**尚未派工**：
`/Users/51mini/.claude/plans/deep-cheer-jackpot-20260921.md`

### 缺陷一：`finalize()` 先分配守則句，鼓勵吃剩的（fixindex 9278）

`lib/compose.js` 算式是 `cheerBudget = max_injection_tokens - prefixTokens - guidanceTokens - 1`，
不足 8 tokens 就把鼓勵丟成空字串、只輸出守則句。

實測（`max_injection_tokens=32`、守則 19t）：

| 前綴 | prefix tokens | cheerBudget | 結果 |
|---|---|---|---|
| `【應援】` | 2 | 10 | 有鼓勵 |
| `【應援・上一輪留給你】` | 6 | 6 | **只剩守則** |
| `【好久沒打招呼了，想跟你說聲辛苦了】` | 9 | 3 | **只剩守則** |

也就是 Tier 2 / Tier 4 **結構性**永遠產不出鼓勵。
證據：09-21 三發 orphan 注入 byte 完全相同、都是 25 tokens。

時間線：守則句第一次進注入是 **2026-09-20T01:28:13Z**；在那之前的注入（09-19，14~16t）是純鼓勵、沒有守則。
守則一進來就把長前綴的鼓勵擠成零。

### 缺陷二：LIFO + 無 TTL → 舊 orphan 永久餓死（fixindex 9279）

`lib/queue.js` 的 `latest()` 依 mtime 取**最新**一張，`orphan_ttl_hours: null` 沒有過期機制。
一次只取一張 + 每次都取最新 = 舊的永遠排在後面。

以 enqueue／consume 對賬驗證過：9 張入列，LIFO 推演預測的倖存檔案與實際剩下的 3 張**完全吻合** ——
順帶排除了「有消費但沒刪檔」這個更嚴重的假設。信箱裡 09-20 07:35Z 與 15:26Z 兩張是永久卡住的實例。

### 量過的數字（訂 config 的依據）

```
EVIDENCE_GUIDANCE                     = 19 tokens
composeTemplate() 輸出 (n=200)        min=10  p50=14  p90=17  max=18
erickson 單行 (n=80)                  min=6   p50=10  p90=12  max=14
前綴：【應援】2t  【應援・上一輪】4t  【應援・久違】4t  【應援・累積 N 份】5t
```

由此推出 `max_injection_tokens = 5 + 19 + 1 + 19 = 44`：最長前綴下鼓勵仍有 19t，
蓋得住語料 max=18，**永不截斷**；再往上加是浪費（語料填不滿）。
原本草案的 56 有 12 格永遠用不到。

### 訂 config 時做過又否決的選項

| 選項 | 為何否決 |
|---|---|
| `guidance_attach_ratio`（守則句機率掛） | 守則句是 A/B 實驗的 B 組刺激本體，降劑量等於毀掉實驗。改成必掛，把 cap 加大到兩者都塞得下 |
| `max_injection_tokens = 56` | 語料 max=18，多的 12 格用不到 |
| `jackpot_bonus_tokens = 16` | 16 才保證每張未領紙條換到完整一句（實測句長 15~18t），但省 token 優先，接受疊不滿就少一句 |
| `jackpot_max_count = 5` | 單發 104t，語料撐不起 |

### 成本模型（別再重算一次）

注入走 `additionalContext`，進 context 後**每回合重送**，
所以成本 ≈ 注入 tokens × 該 session 剩餘回合數，不是一次性。
但真正的固定成本是 PreToolUse hook 每次工具呼叫都要起 node（約 1.6 秒），與 token 數無關。

---

## 觀察工具

```bash
bash /Users/51mini/dev/agent-tools/sbin/cheer-dist [YYYY-MM-DD]   # 預設今天 UTC
```

印 action 分布、注入時刻（UTC）、每 2h 桶注入數、當前滾動視窗狀態。
（`chmod +x` 被沙箱擋住，所以用 `bash <path>` 呼叫。）

判讀基準：`min_inject_interval_minutes=30` 生效時任一 2h 桶應 <= 4 發，
且 `skipped_budget_exhausted` 不該佔全天多數。

## 環境備忘

- `~/.claude/skills/secret-cheeragent/{SKILL.md,corpus.json}` 與 repo 內同名檔是**同 inode 的 hardlink**，
  不是副本 —— 改 repo 即同步，不需要複製覆蓋。
- 工作區有 5 個與本專案無關的未追蹤檔（`hooks/fts-acceptance-gate.js` 及其 3 個 `.bak-*`、
  `skills/secret-cheeragent/.skill_id`），**不要 commit、不要刪**。所以禁用 `git add -A`。
