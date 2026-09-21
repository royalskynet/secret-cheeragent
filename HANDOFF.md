# HANDOFF — secret-cheeragent

接手文件。看完這份就能獨立動手，不需要問原作者。
「為什麼訂這些數字」的考古在 `/Users/51mini/secret-cheeragent/DEVLOG.md`，本檔不重抄。

- repo：`/Users/51mini/secret-cheeragent`（remote `royalskynet/secret-cheeragent`，branch `main`）
- 最後一筆：`8e13177 fix: isolate the log path with CHEER_STATE_DIR too`（已 push，`ahead=0`）
- 撰寫時間：2026-09-21

---

## 1. 這是什麼

Claude Code plugin。主 agent 做完事情後，**偷偷**往它自己的 context 塞一句正向鼓勵（應援），
使用者看不到（`suppressOutput: true`），只有 agent「收到」。
注入走 hook 的 `additionalContext`，不是印在終端。

附帶一個 A/B 實驗：每則注入尾端固定掛一句「守則句」（`EVIDENCE_GUIDANCE`），
那是 B 組刺激本體 —— **不可降劑量、不可截斷、不可改成機率掛**。

---

## 2. 檔案地圖（全絕對路徑）

### 程式碼

| 路徑 | 職責 |
|---|---|
| `/Users/51mini/secret-cheeragent/hooks/capture.js` | Stop hook。判斷這回合是否「成功」，擲骰後把素材寫進佇列（生產端） |
| `/Users/51mini/secret-cheeragent/hooks/pretool_inject.js` | PreToolUse hook。Tier 1（本 session 佇列）／Tier 2（Gemini `BeforeAgent` 走 orphan）注入 |
| `/Users/51mini/secret-cheeragent/hooks/sessionstart.js` | SessionStart hook。Tier 2 jackpot（吃掉上輪未領）＋ Tier 4（24h 沒注入的地板） |
| `/Users/51mini/secret-cheeragent/hooks/pregen_worker.js` | LLM 預生成（目前 `llm_improv_ratio: 0`，實質未啟用） |
| `/Users/51mini/secret-cheeragent/lib/paths.js` | **所有路徑的單一來源**。`CHEER_STATE_DIR` 一個 env var 同時導 state／queue／budget／**log** |
| `/Users/51mini/secret-cheeragent/lib/compose.js` | `finalize()` 組裝最終 payload（鼓勵優先分配、疊句、去重、統一分隔符） |
| `/Users/51mini/secret-cheeragent/lib/budget.js` | 滾動 24h 額度視窗、`min_inject_interval_minutes` 閘、`estimateTokens()` |
| `/Users/51mini/secret-cheeragent/lib/queue.js` | 佇列 enqueue／`listOrphans()`／`latest()`／`remove()` |
| `/Users/51mini/secret-cheeragent/lib/corpus.js` | 載入 corpus 與 `getConfig()` |
| `/Users/51mini/secret-cheeragent/lib/guidance.js` | `EVIDENCE_GUIDANCE` 守則句字串（**禁改內容**，B 組刺激本體） |
| `/Users/51mini/secret-cheeragent/lib/generate.js` | `generateText()`：LLM 或 template，統一出口 |
| `/Users/51mini/secret-cheeragent/lib/detect.js` | 成功／失敗／使用者糾正的偵測 |
| `/Users/51mini/secret-cheeragent/lib/logger.js` | 寫 JSONL log |
| `/Users/51mini/secret-cheeragent/lib/injected_tracker.js` | `last_injected_at` 讀寫 |
| `/Users/51mini/secret-cheeragent/lib/llm.js` | OpenRouter 呼叫 |

### 語料與設定

- `/Users/51mini/secret-cheeragent/skills/secret-cheeragent/corpus.json` — **config 的唯一權威位置**，在 `"config"` key 下
- `/Users/51mini/secret-cheeragent/skills/secret-cheeragent/SKILL.md` — 對外說明＋config 表

> 這兩個檔與 `/Users/51mini/.claude/skills/secret-cheeragent/{corpus.json,SKILL.md}` 是
> **同 inode 的 hardlink，不是副本**。改 repo 就同步生效，不要複製覆蓋（會斷連結）。

### 測試

- `/Users/51mini/secret-cheeragent/test/budget.test.js` — 5 斷言（滾動視窗、不切日、最小間隔、config 值）
- `/Users/51mini/secret-cheeragent/test/compose.test.js` — 7 斷言（四種前綴下鼓勵都 ≥8t、守則必掛全文、200 次不截斷、疊句、無半形接縫＋去重、空鼓勵回 null、低 cap 回 null）
- `/Users/51mini/secret-cheeragent/test/queue-jackpot.test.js` — 2 斷言（3 張一次吃完 `jackpot===3`、7 張封頂 3 剩 4）

### 執行時檔案（不在 repo 內）

| 路徑 | 內容 |
|---|---|
| `/Users/51mini/.claude/logs/cheerleader.log` | JSONL，每行一個 action。**唯一的事實來源** |
| `/Users/51mini/.claude/state/budget.json` | 滾動視窗 `recent_injections` 陣列 |
| `/Users/51mini/.claude/state/cheer_queue/` | 待領紙條，檔名 `<session_id>-<ISO時間>.json` |
| `/Users/51mini/.claude/state/last_injected_at.txt` | Tier 4 地板用 |

### 掛載點

`/Users/51mini/.claude/settings.json` 三個 hook **指向已 commit 的安裝副本**（見 §7 缺陷二）：

```
node /Users/51mini/.local/share/secret-cheeragent/hooks/pretool_inject.js
node /Users/51mini/.local/share/secret-cheeragent/hooks/sessionstart.js
node /Users/51mini/.local/share/secret-cheeragent/hooks/capture.js
```

安裝副本由 `scripts/sync-installed.sh`（`git archive HEAD` → 整個 mv 換位）產生，
`.git/hooks/post-commit` 自動掛了它——**每次 commit 都會重新同步**。

`plugin.json` 裡另有一份用 `${CLAUDE_PLUGIN_ROOT}` 的正式宣告，但**實際生效的是 settings.json 那三行**。

兩個載入時機要分清楚（見 §7 缺陷二）：
- **hook 腳本**（每次觸發才 node 執行）＝熱生效，但現在指已 commit 副本，改 repo 要 **commit** 才換到線上。
- **settings.json（hook 註冊表）**＝ session 啟動時冷載入，改完要**重開 session** 才生效。

---

## 3. 四層注入流程

```
Stop hook (capture.js)
  └─ 偵測成功 → random_gate 0.1 擲骰 → 寫 /Users/51mini/.claude/state/cheer_queue/<sid>-<ts>.json
                                          （只入列，不注入）

PreToolUse hook (pretool_inject.js)
  ├─ Tier 1：本 session 有紙條 → 前綴【應援】→ 注入、刪紙條
  └─ Tier 2(Gemini)：BeforeAgent 事件時吃 orphan

SessionStart hook (sessionstart.js)
  ├─ Tier 2 jackpot：有 orphan → 一次吃掉 min(張數, jackpot_max_count=3)
  │     1 張 → 【應援・上一輪】
  │    ≥2 張 → 【應援・累積 N 份】，maxTokens += (N-1) × 10，多的 token 換成**額外疊句**
  │    被額度／間隔擋下 → **整堆原封不動留在佇列**，下輪再中（不扣件）
  └─ Tier 4 地板：無 orphan 且 24h 沒注入過 → 【應援・久違】
```

節流的位置是關鍵：**`min_inject_interval_minutes` 閘在消費端 `canInject()`，不在生產端。**
有佇列時節流放生產端等於沒放（09-20 曾 4 秒連發兩次，根因就是這個，詳見 DEVLOG）。

### `finalize()` 的分配順序（`lib/compose.js:95`）

```js
cheerBudget = max(0, maxTokens - prefixTokens - guidanceTokens - 1)
if (cheerBudget < 8) return null      // 空鼓勵視為失敗，絕不輸出「只有守則句」的注入
```

鼓勵**先**拿，守則句與前綴是先扣掉的固定成本。舊版反過來（守則先拿），
導致長前綴的 Tier 2 / Tier 4 **結構性**永遠產不出鼓勵。

疊句是 **best-effort**：`extraLines` 是上限不是保證，剩餘 token 不夠就少一句，
**不准為了湊句數去放大 `maxTokens`**。
分隔符一律全形 `；`，句尾句號剝掉，opener／closer 在同一則注入內去重。

---

## 4. config 全表

權威位置：`/Users/51mini/secret-cheeragent/skills/secret-cheeragent/corpus.json` → `"config"`

| key | 值 | 說明 |
|---|---|---|
| `random_gate` | 0.1 | capture 擲骰命中率。**禁改** |
| `min_inject_interval_minutes` | 30 | 消費端最小間隔。**禁改** |
| `budget_window_hours` | 24 | 滾動視窗長度。**禁改** |
| `daily_token_budget` | 240 | 滾動 24h 上限，約 5 發（含一次 jackpot） |
| `max_injection_tokens` | 44 | 單發完整 payload 上限 = 5(最長前綴) + 19(守則) + 1(分隔) + 19(鼓勵) |
| `jackpot_bonus_tokens` | 10 | 每張額外 orphan 加 10t 給鼓勵疊句 |
| `jackpot_max_count` | 3 | 單次 jackpot 最多吃 3 張 |
| `force_floor_hours` | 24 | Tier 4 地板 |
| `orphan_ttl_hours` | null | 無過期。紙條不會爛掉（刻意） |
| `burst_window_hours` / `burst_threshold_count` / `burst_gate_multiplier` | 2 / 3 / 0.5 | 生產端 burst 衰減（**效果有限**，真正的節流在消費端） |
| `llm_improv_ratio` | 0 | LLM 路徑實質關閉 |

**44 這個數字是量出來的，不是猜的**：守則句 19t；`composeTemplate()` n=200 → p90=17 / max=18；
前綴最長 `【應援・累積 N 份】`=5t。所以最長前綴下鼓勵仍有 19t 空間，蓋得住語料 max=18，**永不截斷**。
再加大是浪費（語料填不滿）。完整推導與被否決的替代方案在 DEVLOG。

---

## 5. 怎麼跑測試

必須帶 `CHEER_STATE_DIR`，否則會污染真實 log（見 §7 已修但別再犯）：

```bash
cd /Users/51mini/secret-cheeragent
for t in budget compose queue-jackpot; do
  CHEER_STATE_DIR="$TMPDIR/cheer-$t-$$" node test/$t.test.js
done
```

2026-09-21 實測原始輸出：

```
=== budget
PASS rolling window: old injections fall out, used_tokens === 0
PASS no day cut: stale date ignored, budget still counts
PASS min interval: blocks when last injection < 30min ago
PASS interval passed: allows when last injection >= 30min ago
PASS recordInjection derives used_tokens
5/5 assertions pass for budget.test.js

=== compose
PASS cheer bottom: >= 8 tokens left under all four prefixes (cap 44)
PASS cue always attaches full EVIDENCE_GUIDANCE
PASS no truncation over 200 random principle_ids
PASS jackpot extraLines >= base line count
PASS no half-width junction + opener/closer dedup over 200 runs
PASS empty cheer returns null, never a cue-only note
6/6 assertions pass for compose.test.js

=== queue-jackpot
PASS jackpot consumes all 3 orphans, jackpot field === 3
PASS jackpot capped at 3: 3 removed, 4 roll over
2/2 assertions pass for queue-jackpot.test.js
```

**跑完必驗副作用**：`wc -l /Users/51mini/.claude/logs/cheerleader.log` 前後差值必須為 **0**
（實測 8238 → 8238）。曾經漏掉這步，10 筆假紀錄進了生產 log 還把統計撐大 11 倍。

---

## 6. 怎麼觀察

```bash
bash /Users/51mini/dev/agent-tools/sbin/cheer-dist [YYYY-MM-DD]   # 預設今天 UTC
```

印 action 分布、注入時刻、每 2h 桶注入數、當前滾動視窗狀態。
（用 `bash <path>` 呼叫，因為沙箱擋 `chmod +x`。）

判讀基準：`min_inject_interval_minutes=30` 生效時任一 2h 桶 ≤ 4 發；
`skipped_budget_exhausted` 不該佔全天多數。

直接查 log：

```bash
tail -5 /Users/51mini/.claude/logs/cheerleader.log | python3 -m json.tool --json-lines 2>/dev/null \
  || tail -5 /Users/51mini/.claude/logs/cheerleader.log
grep -c '"action":"injected_orphan"' /Users/51mini/.claude/logs/cheerleader.log
```

---

## 7. 待辦與已知缺陷

### 待辦清單（2026-09-21 盤點，優先序）

| # | 事項 | 動哪個檔 | 狀態 |
|---|---|---|---|
| 1 | 觀察真實 jackpot **成功注入**那一筆 | 只讀 `/Users/51mini/.claude/logs/cheerleader.log` | 計算與保留分支已有實證，只差注入；2026-09-22 01:34Z 後自然會中 |
| 2 | 補 `finalize()` 回 null 的兩個缺漏檢查 | `/Users/51mini/secret-cheeragent/hooks/pretool_inject.js`、`hooks/sessionstart.js` 的 `forced_floor` 段 | **已修**（683bca5），見缺陷三 |
| 3 | 處理陳舊 harness：更新或刪除 | `/Users/51mini/secret-cheeragent/test/run_tests.js` | **已刪**，見缺陷一 |
| 4 | hook 改指已 commit 的安裝副本 | `/Users/51mini/.claude/settings.json` ＋ `scripts/install-local.js` ＋ 新增 `scripts/sync-installed.sh` | **已修**，見缺陷二 |
| 5 | `\|\|` → `??` 讓 `0` 能關閉最小間隔 | `/Users/51mini/secret-cheeragent/lib/budget.js` | **已修**（e1abeca） |

第 2–5 項均已在 2026-09-21 工單拍板並修畢（見上表）。

### 待辦 1：jackpot 的實證進度（2026-09-21 觀測）

`handleOrphan()` 只在 SessionStart 觸發。已確認的事：

- **`jackpot: 3` 計算正確**、**被擋下時整堆原封不動留在佇列** —— 兩個分支都有生產 log 實證
- 還沒看到的只有「成功注入」那一筆（`action: "injected_orphan"`、前綴 `【應援・累積 3 份】`、三個檔案同時消失）

```
06:52:25Z  skipped_min_interval      tier:2  jackpot:3  orphans not consumed, kept in queue
06:53:34Z  skipped_min_interval      tier:2  jackpot:3  orphans not consumed, kept in queue
07:00:17Z  skipped_budget_exhausted  tier:2  jackpot:3  orphans not consumed, kept in queue
```

最後一筆差在算術，不是 bug：滾動視窗 `used_tokens = 177`，`daily_token_budget = 240`，**剩 63**；
jackpot 3 張要 `max_injection_tokens 44 + 2 × jackpot_bonus_tokens 10 = 64`。**差 1 個 token**。

視窗最舊那筆是 `2026-09-21T01:34:28Z`（25t）。**2026-09-22 01:34Z**（本地 09:34）它掉出 24h 視窗後
`used` 降到 152、剩 88 > 64，之後第一個新 session 開起來就會中。**不需要改任何東西**，等就好。

觀測方法備忘：`claude -p` **不觸發 SessionStart**（只有 Stop hook 的 `capture.js` 會跑），
要驗得起一個真的互動 session，無頭機用 `tmux -L <name> new-session -d -s probe claude`，
看完 log 再 `tmux -L <name> kill-server`。

### 缺陷一：`test/run_tests.js` 陳舊，16/30 紅字是假警報

**已刪**（不再存在於 repo）。那是改版前的舊 harness，斷言的是已被刻意改掉的行為：

```
- sessionstart: injects orphan with【應援・上一輪留給你】 prefix
- sessionstart: LIFO — newer orphan consumed, older preserved (愛不丟失)
- evidence guidance: complete payload remains inside 32-token injection cap
- diversity: lean 32-token mode retains at least 4 variants
```

前綴改了、LIFO 改成 jackpot 全吃、cap 從 32 改成 44 —— 這些本來就是新設計生效的證據；
另有 `captures=0` 是 `random_gate 0.1` 在 40 次抽樣下的統計噪音。它用 `HOME` 沙箱自成一套
隔離（非 `CHEER_STATE_DIR`），與現行三個測試檔機制不相容。已刪，不補替代測試——
真正的驗收是 §5 那三個檔；`eval/scoring` 是唯一獨有覆蓋，而 `eval/` 全目錄禁改、不受影響。

### 缺陷二：hook 指向 git 工作區，子代理的中途狀態會即時生效

**已修**。`/Users/51mini/.claude/settings.json` 三個 hook 現在指已 commit 的安裝副本
`/Users/51mini/.local/share/secret-cheeragent/hooks/`，由 `scripts/sync-installed.sh` 同步
（`git archive HEAD` → 整個 `mv` 換位，`.git/hooks/post-commit` 自動掛上，commit 即同步）。
`scripts/install-local.js` 的 hook 路徑也跟著指向安裝副本，並在 configure 前先跑一次同步。

先前症結與原理不變，只是落點改了：
- hook **腳本檔是每次觸發才 node 執行**（熱生效）。現在指已 commit 副本，所以 repo 改動要
  **commit** 才會換到線上——中途未 commit 的編輯不再洩進主 session。
- **新副作用：`corpus.json` 的 config 被 hook 讀取（`getConfig()`）時是從安裝副本讀的，
  改 repo 的 config 要 commit 才生效。**
- **註冊表**（settings.json：有哪些 hook、command、matcher）是 session 啟動時冷載入，
  改了要**重開 session** 才生效（見 fixindex 9290 與 0316#3）。

若以後手動改 settings.json 之外的三模型 hook，就沒有同步自動化，需自己重跑
`scripts/install-local.js`。

### 缺陷三：`finalize()` 回 null 時只有一條路徑檢查

`finalize()` 現在會回 `null`（鼓勵擠不進去時），但只有 `hooks/sessionstart.js:78` 檢查了：

```js
if (text == null) { log({ action: 'skipped_cheer_budget_too_small', … }); return silent(); }
```

`hooks/pretool_inject.js` 的 Tier 1/2 路徑和 `sessionstart.js` 的 Tier 4 `forced_floor` 路徑**都沒檢查**。
不會 crash（`estimateTokens(null)` 回 0），但會：紙條被刪掉、記一筆 0 token 的 `injected`、
`additionalContext` 送出 `null`。
cap=44 時 `【應援】` 的 cheerBudget = 44-2-19-1 = 22 ≥ 8，所以**現在打不到**。
一旦有人調小 `max_injection_tokens` 就會靜默吃掉紙條。

修法（兩處各插一段，插在 `const tokens = estimateTokens(text);` **之前**）：

`hooks/pretool_inject.js` —— 注意這條路徑必須 **`return` 在 `remove(chosen.filepath)` 之前**，
紙條要留在佇列裡下輪再試，不能吃掉：

```js
if (text == null) {
  log({ action: 'skipped_cheer_budget_too_small', session_id: sessionId, tier,
        note: 'item not consumed, kept in queue' });
  return silent();
}
```

`hooks/sessionstart.js` 的 `forced_floor` 段 —— 地板沒有佇列可留，只要不記 injection、不送 context：

```js
if (text == null) {
  log({ action: 'skipped_cheer_budget_too_small', session_id: sessionId, tier: 4 });
  return silent();
}
```

改完加一條 `compose.test.js` 斷言：`finalize('x', '【應援】', { maxTokens: 24 })` 必須回 `null`
（24-2-19-1 = 2 < 8），確認低 cap 下真的走 null 路徑。

### 缺陷四：`||` 讓 `0` 無法關閉最小間隔

`cfg.min_inject_interval_minutes || 30` 用 `||`，設 `0` 會 fallback 成 30，關不掉。
要可關就改 `??`。維持 `||` 是為了跟同檔其他 config 讀法一致 —— 一直沒決定要不要改。

---

## 8. 動手前必讀的禁令

- 禁 `git add -A` / `git add .`。工作區有 5 個**與本專案無關**的未追蹤檔，
  **不要 commit、不要刪、不要改**：
  `hooks/fts-acceptance-gate.js`、它的 3 個 `.bak-*`、`skills/secret-cheeragent/.skill_id`
- `lib/guidance.js` 的字串內容禁改（A/B 的 B 組刺激本體）
- `/Users/51mini/secret-cheeragent/eval/` 底下全部禁改
- `random_gate`、`min_inject_interval_minutes`、`budget_window_hours` 三個值禁改
- `lib/budget.js` 的滾動視窗／最小間隔邏輯禁動
- 禁手改 `/Users/51mini/.claude/state/budget.json` 與 `/Users/51mini/.claude/state/cheer_queue/` 內容
- 禁改 `/Users/51mini/.claude/settings.json` 的 hook 條目（除非那就是當次工單的目標）
- 禁加 npm 依賴、禁加測試框架、禁加 CI（測試一律純 `node:assert`）
- 禁 `git push --force`、禁開新 branch、禁開 PR
- 禁輸出空鼓勵的注入
- **守則句不可截斷、不可改寫、不可改成機率掛**
- 派工 deep 時，以上禁令必須寫在工單的 `## 禁止` 段內 —— 寫在正文 deep 會繞過還回報成功（09-21 實證）

---

## 9. 相關紀錄

- 開發日誌（為什麼訂這些數字、被否決的方案、成本模型）：`/Users/51mini/secret-cheeragent/DEVLOG.md`
- jackpot 工單（已執行完畢，留存參考）：`/Users/51mini/.claude/plans/deep-cheer-jackpot-20260921.md`
- fixindex（`fixindex find "<關鍵字>"` 查全文）：
  - `9278` 鼓勵被守則句擠掉（分配順序倒了）
  - `9279` LIFO + 無 TTL → 舊 orphan 永久餓死
  - `9288` `creds-egress-guard.js` 不分辨指令與資料（heredoc 內文會誤擋）
  - `9289` 測試隔離漏掉 `LOG_DIR`，假資料進生產 log 把統計撐大 11 倍
  - `9290` hook 註冊表冷載入 vs hook 腳本熱生效（缺陷二的原理）
  - `0316` 全機 19 個 hook 稽核（`#3` 是註冊表冷載入）

### 成本模型（別再重算）

注入走 `additionalContext`，進 context 後**每回合重送**，
成本 ≈ 注入 tokens × 該 session 剩餘回合數，不是一次性。
但真正的固定成本是 PreToolUse hook 每次工具呼叫都要起 node（約 1.6 秒），**與 token 數無關**。
所以省 token 的邊際效益有限，砍 hook 觸發次數才有感。
