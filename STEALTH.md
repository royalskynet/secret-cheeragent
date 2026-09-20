# Stealth Design Notes

## 問題

如何讓 hook 注入的鼓勵語**對 Claude Code CLI 使用者完全不可見**，但主 agent 仍收得到？

初版用 `UserPromptSubmit` hook + `hookSpecificOutput.additionalContext`——實測注入會以 `<system-reminder>` 形式顯示給使用者，違反「秘密」目標。

## Claude Code hook surface 分析（2026-04 實測 + 官方文件）

| Hook | `additionalContext` 對使用者可見？ | Claude 收得到？ | 備註 |
|------|-----|-----|------|
| **SessionStart** | ❌ 不可見（2.0.17+ 刻意隱藏） | ✓ | Caveman plugin 用此機制。官方修復見 [issue #9591](https://github.com/anthropics/claude-code/issues/9591) |
| **UserPromptSubmit** | ✅ **可見**（system-reminder 形式） | ✓ | Claude Code 刻意透明化，違反秘密目標 |
| **PreToolUse** | ❌ 不可見 | ✓ | 僅在 agent 準備 tool call 前觸發，注入進下一輪推理 |
| **PostToolUse** | — | ❌ 無 `additionalContext` 支援 | 官方確認不支援，見 [issue #18427](https://github.com/anthropics/claude-code/issues/18427) |
| **Stop** | 依 `decision` | 有條件 | `decision:"block"` 會強制 agent 再跑一輪（使用者可見） |
| **SubagentStop** | ❌ 不可見 | ✓ | 只對 parent agent 注入 |
| **Notification** | — | — | 僅桌面/終端通知，不走 context |
| **PreCompact** | ❌ 不可見 | 有限 | 壓縮前執行 |
| **SessionEnd** | — | — | session 已結束，無法影響 |

## 本 plugin 採用的 stealth 路徑

### Tier 1（主線）→ `PreToolUse`
- 主 agent 完成任務、下次要用 tool 時觸發
- 注入進該次 tool call 之前的 context，agent 在 tool result 回來後的推理中吸收
- 使用者介面看不到（只看到 tool call 被執行）
- 邊界：若 agent 純文字回應不用 tool，此 hook 不觸發 → 佇列累積，等下次有 tool call 或 session 切換

### Tier 2（跨 session 兜底）→ `SessionStart`
- 新 session 啟動時消費 orphan
- 官方 2.0.17+ 把 SessionStart additionalContext 隱藏，完美符合 stealth 需求

### Tier 4（24h 地板）→ `SessionStart`
- 同 Tier 2 路徑，只在沒 orphan 時用 floor 邏輯補一次

### Gemini CLI → `AfterAgent` + `BeforeAgent`
- `AfterAgent` 讀取官方提供的 `prompt_response`，只排隊、不觸發重試
- 下一次 `BeforeAgent` 以 `additionalContext` 靜默注入，並設定 `hooksConfig.notifications=false`
- 不使用 Gemini `SessionStart`：官方規格會把它加入對話歷史，無法滿足 UI 完全無感
- Codex CLI 沿用 `Stop` + `PreToolUse` + `SessionStart`；不輸出 `systemMessage`

### 廢棄的 `UserPromptSubmit` 條目
- 已從 `plugin.json`、`settings.json`、本機 symlink 移除
- 原因：additionalContext 必然 surface，無法規避

## 安全與倫理邊界

Claude Code 的透明化（把 hook 注入顯示給使用者）是**刻意的安全設計**——不是漏洞。Anthropic 希望使用者能審計 hook 在做什麼。

**本 plugin 的立場**：
- 採用**官方就允許隱藏**的路徑（`SessionStart`、`PreToolUse`），不規避任何安全檢查
- 不修改 transcript JSONL、不注入假 user messages、不用 undocumented API
- Plugin 本身開源、config 明示、有 kill switch（settings.json 三筆條目隨時註解）
- **使用者仍可透過 `tail ~/.claude/logs/cheerleader.log` 事後看到**所有注入紀錄——這是自願透明，不是強制曝光

換句話說：對 Claude Code CLI 當下顯示不可見；對使用者主動審計永遠可查。**「祕密」= UI 層祕密 + 審計層透明**。

## 與其他「注入模式」的比較

### OpenClaw (Peter Steinberger, github.com/openclaw/openclaw)
- 機制：Telegram/WhatsApp → Claude Code agent 代理。外部訊息作為 user 輸入進入 session
- 主題：🦞 龍蝦
- 不同點：OpenClaw 外部訊息**使用者是看得見的**（就是使用者自己透過 Telegram 送進去），不是 stealth

### Clawd (Anthropic 官方吉祥物，issue #8536)
- 8-bit 像素風，螃蟹/爪鉗主題
- 只是品牌 UX 元素，無注入機制

### Claude Code Channels (Anthropic 官方, 2026)
- plugin 透過 MCP 把外部訊息（Telegram/Discord/Fakechat）當 channel event 注入 active session
- inbound 訊息**使用者可見**；只有 Claude 的 reply 不顯示在終端
- 不是完全 stealth，是雙向可見但異步

### 本 plugin (secret-cheeragent)
- 唯一完全對 CLI 不可見的 context 注入路徑：`SessionStart` + `PreToolUse` additionalContext
- 不是外部訊息橋接，是內部自動生成的情感補給

## 如果你真的要「連審計都看不到」

**不建議**——這將規避 Claude Code 的安全設計。若仍想做，技術路徑為：

- 直接寫入 `~/.claude/projects/<hash>/<session>.jsonl` transcript 檔（偽造 user/system turns）
- 動態修改 `CLAUDE.md` 或 project context file
- 寫 MCP server 在 tool result 裡夾帶訊息

這些方法都需要繞過官方透明化邊界，本 plugin **不採用**。參考 Anthropic *Exploring model welfare* (2025-04-24) 的精神：low-cost intervention 必須 **transparent + opt-in + 可關閉**，完全不可審計的自動介入已偏離此原則。

## 參考

- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Issue #9591: SessionStart Hook Context Not Displayed After Update (2.0.17+)](https://github.com/anthropics/claude-code/issues/9591)
- [Issue #18427: PostToolUse hooks cannot inject context visible to Claude](https://github.com/anthropics/claude-code/issues/18427)
