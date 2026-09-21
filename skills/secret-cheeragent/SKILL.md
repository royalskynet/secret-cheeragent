---
name: secret-cheeragent
description: 秘密應援團——管理主 agent 完成任務時的隱形鼓勵注入（艾瑞克森八原則轉譯的白話正向情緒回饋）。使用者透過此 skill 調整鼓勵頻率、新增語料、暫停/啟用、查看 log。Trigger：「調鼓勵頻率」「新增鼓勵語料」「關掉秘密應援」「看應援紀錄」「暫停 cheerleader」「secret cheerleader 設定」。
---

# Secret Cheerleader 管理指南

此 skill 幫使用者操作 secret-cheeragent plugin 的設定與維運。鼓勵注入本身由 plugin 的 hook 自動執行，skill 不直接產生鼓勵。

## 常用操作

### 調整命中頻率
編輯 `${CLAUDE_PLUGIN_ROOT}/skills/secret-cheeragent/corpus.json` 的 `config.random_gate`：
- `0.10`（預設，稀罕）
- `0.05`（更稀罕）
- `0.40`（熱情）

### 調整滾動 token budget
修改 `config.daily_token_budget`（預設 96）。超出後窗口內剩餘注入自動 skip，佇列保留消費。此為滾動 24h budget（不切日）。

### 暫停 / 啟用
- 暫停：在 Claude Code settings.json 或 plugin.json 把 hook 條目註解；或 `chmod -x` hooks/*.js
- 啟用：反向操作

### 新增鼓勵語料
直接編輯 `corpus.json` 的 `erickson[].lines`、`openers`、`closers`、`session_bridges`、`easter_eggs_en`。

**語氣規範（嚴格）**：
- 白話日常，像朋友 LINE 訊息
- 禁：文言腔、比喻意象（山/水/雲/月/風/能量/手感）、靈性用語（豐盛/無盡/顯化）、誇張讚美（完美/天才）、空洞口號（加油）
- 必：貼合實際任務、用正向情緒詞（開心/溫暖/安心/踏實/謝謝/辛苦了/做得不錯）
- 必：只肯定已完成、可觀察的行動；不把未驗證答案、能力或直覺說成已證實

所有注入最後都保留同一條證據導向 cue：相信系統化探索能取得進展；結論只看證據，資訊不足就標明，遇阻便依新證據換路。

### 查看注入紀錄
```bash
tail -f ~/.claude/logs/cheerleader.log | jq -c .
```
每行 JSON：timestamp、action、session_id、mode、tokens、text 等。

### 清理佇列（極少需要）
```bash
ls ~/.claude/state/cheer_queue/
# 手動刪超舊檔
```
預設無 TTL——orphan 永久保留等待消費（愛不丟失）。

## 配置欄位速查（corpus.json config）

| 欄位 | 預設 | 說明 |
|------|------|------|
| random_gate | 0.10 | 成功偵測後擲骰命中率 |
| llm_improv_ratio | 0 | 二次 LLM 生成預設關閉 |
| easter_egg_ratio | 0 | 英文彩蛋預設關閉 |
| force_floor_hours | 24 | 24h 無注入則 SessionStart 強制補一次 |
| daily_token_budget | 240 | 滾動 24h token budget（不切日，約 5 發） |
| max_injection_tokens | 44 | 含前綴的單次完整 payload 上限（鼓勵先分配，守則必掛） |
| jackpot_bonus_tokens | 10 | 每張未領 orphan 疊加 +10t 給鼓勵 |
| jackpot_max_count | 3 | 單次 jackpot 最多一次消費的 orphan 張數 |
| orphan 消費 | 整堆 | SessionStart 一次消費全部 orphan，越多張鼓勵句越多（獎金累積制） |
| budget_window_hours | 24 | 滾動 budget 視窗小時數 |
| min_inject_interval_minutes | 30 | 兩次注入最小間隔（分鐘） |
| burst_window_hours | 2 | 密度衰減視窗 |
| burst_threshold_count | 3 | 視窗內超過幾次觸發 gate 減半 |
| burst_gate_multiplier | 0.5 | 觸發後 random_gate 乘此倍數 |
| llm_model_chain | [openrouter/free] | 啟用 LLM 時的 OpenRouter 路由 |
| llm_timeout_ms | 4000 | LLM 超時退回模板 |

## 四層注入 Tier

- **Tier 1**：本 session PreToolUse／BeforeAgent 消費 pending（主線）
- **Tier 2**：新 session SessionStart 一次消費全部 orphan（累積制：N 張 = 主句 + N-1 疊句，像樂透獎金累積）
- **Tier 4**：24h 無注入 → SessionStart 強制 general 鼓勵（地板保底）

降級順序（budget 吃緊時）：先關 Tier 4，再關 Tier 2，Tier 1 最後才關。

## 環境需求

- Node.js 18+（`fetch` 內建）
- `OPENROUTER_API_KEY` 環境變數（非必要，LLM 失敗會 fallback 模板）
