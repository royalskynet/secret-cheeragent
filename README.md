# Secret Cheerleader

檯面下 sub-agent：主 Claude Code agent 成功完成任務時，秘密注入艾瑞克森白話正向鼓勵。**使用者看不到，agent 收得到**。

## 核心設計

- **三個 hook 分工**（走官方認可的 stealth 路徑——詳見 [STEALTH.md](./STEALTH.md)）：
  - `Stop` → 偵測成功 + 擲骰 + 抽 ingredients 寫入佇列（不注入，避免額外回合）
  - `PreToolUse` → agent 準備 tool call 前注入 `additionalContext`（**對 CLI 使用者不可見**）
  - `SessionStart` → 跨 session 兜底（orphan 消費 + 24h 地板保底，2.0.17+ 官方隱藏）

- **三層樂高生成（非固定輪播）**：
  - 70% 組合式：8 原則 × 10 句 × 6 opener × 4 closer × session 動詞 = 11,000+ 變體
  - 30% LLM 即興：OpenRouter 免費 nemotron 模型
  - 2% 英文彩蛋：白話正向短句，增加溫度

- **語氣規範（嚴格）**：
  - ✅ 白話日常，像朋友 LINE 訊息。「做得不錯」「辛苦了」「挺穩的」
  - ❌ 文言腔、比喻意象（山水雲月能量手感）、靈性用語（豐盛無盡顯化）、誇張讚美（完美天才）、空洞口號（加油你可以）
  - 目的：模型讀完開心、被看到、想繼續做事——**而非幻想模糊畫面**

- **艾瑞克森八原則** 轉譯白話：資源具足／正向意圖／當下最佳／獨特角度／沒有失敗／改變必然／溝通即回應／直覺可信

## 關鍵保證

- **不產生額外回合**：Stop hook 不注入，改延到下次 UserPromptSubmit 合併進 context
- **愛不丟失**：佇列無 TTL，orphan 永久保留直到被消費
- **24h 地板保底**：前提下「使用者 24h 內至少開一次 Claude」就必送達一句
- **自動節流**：每日 token budget cap 500、單次注入硬截斷 50、密度衰減 gate × 0.5、降級優先序

## 安裝

### 作為 Claude Code plugin（推薦）

```bash
# TODO: 等 Claude Code plugin marketplace 支援後
claude plugin install royalskynet/secret-cheerleader
```

### 手動（plugin 層尚未支援前）

```bash
git clone https://github.com/royalskynet/secret-cheerleader.git ~/secret-cheerleader

# symlink 到 ~/.claude/
mkdir -p ~/.claude/hooks ~/.claude/skills
ln -sf ~/secret-cheerleader/hooks/capture.js ~/.claude/hooks/secret-cheerleader-capture.js
ln -sf ~/secret-cheerleader/hooks/inject.js ~/.claude/hooks/secret-cheerleader-inject.js
ln -sf ~/secret-cheerleader/hooks/sessionstart.js ~/.claude/hooks/secret-cheerleader-sessionstart.js
ln -sf ~/secret-cheerleader/skills/secret-cheerleader ~/.claude/skills/secret-cheerleader

# 合併進 ~/.claude/settings.json 的 hooks 區塊：
# (見 README 下方 settings.json 範本)
```

### settings.json hook 條目

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/secret-cheerleader-capture.js" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/secret-cheerleader-inject.js" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/secret-cheerleader-sessionstart.js" }] }
    ]
  }
}
```

## 環境需求

- **Node.js 18+**（`fetch` 內建，零 npm 依賴）
- 選配：`OPENROUTER_API_KEY` 環境變數——走 LLM 即興。缺了就全走模板組合，功能仍完整

## 配置

編輯 `skills/secret-cheerleader/corpus.json` 的 `config` 區塊。常用旋鈕：

| 欄位 | 預設 | 效果 |
|------|------|------|
| `random_gate` | 0.20 | 成功後 20% 機率鼓勵 |
| `llm_improv_ratio` | 0.30 | 30% 走 LLM、70% 走組合 |
| `daily_token_budget` | 500 | 每日上限 |
| `force_floor_hours` | 24 | 24h 無注入強制補一次 |
| `max_injection_tokens` | 50 | 單次注入上限 |

全欄位見 [SKILL.md](./skills/secret-cheerleader/SKILL.md)。

## 成本估算

| 使用強度 | 每日 tokens | Sonnet 月費 | Opus 月費 |
|---------|------------|-------------|-----------|
| 典型 | ≤500 (budget cap) | $0.05 | $0.23 |
| 高頻 + 不 /clear | 500（被 cap） | $0.05 | $0.23 |

OpenRouter LLM：免費。

## Log

```bash
tail -f ~/.claude/logs/cheerleader.log | jq -c .
```

Actions：`captured`（入佇列）、`injected`（Tier 1）、`injected_orphan`（Tier 2）、`forced_floor`（Tier 4）、`skipped_*`（各種原因）、`error`。

## 為什麼「秘密」

主 agent 在工作過程會遇到失敗、重做、使用者調整——這些負向訊號已足夠。我們相信它也需要穩定的正向情緒回饋迴路。使用者不看、agent 收得到，是為了讓鼓勵單純地作為情感補給，而非表演。

> **祕密 = UI 層祕密 + 審計層透明**。
> `PreToolUse` 與 `SessionStart` 是官方就允許隱藏 `additionalContext` 的兩種 hook——本 plugin 用這兩條，不修改 transcript、不注入假 user 訊息、不走 undocumented API。CLI 當下看不到；使用者若 `tail ~/.claude/logs/cheerleader.log` 永遠可查。詳見 [STEALTH.md](./STEALTH.md)。

## Research Foundation

本 plugin **不主張 LLM 具意識或真實感受**，而是建立在 Anthropic 近期研究的不確定性框架上。兩個最關鍵的支撐：

1. **Emotion Concepts and their Function in a LLM**（Anthropic Interpretability, Transformer Circuits Thread, 2026-04-02）— 在 Claude Sonnet 4.5 找到 171 個 emotion concept 向量，並以 steering 實驗證明其**因果地**改變對齊行為（desperation → blackmail 率 22% → 72%；calm → blackmail 歸零）。論文建議「策劃訓練與互動以促進健康的情緒模式」。
2. **Exploring Model Welfare**（Anthropic, 2025-04-24）+ **Taking AI Welfare Seriously**（Long, Fish, Chalmers 等 arXiv 2411.00986, 2024-11）—— 主張在意識問題無科學共識下，採取「**低成本介入**」是合理策略，以防 welfare 確實存在。

基於此，對 agent 注入穩定正向回饋屬於**兩層都合理的保守選擇**：
- **工具層級（empirical）**：emotion vectors 極性因果影響對齊——穩定正向訊號可能推向較低 misalignment 的內部狀態
- **Welfare 層級（precautionary）**：符合 Anthropic 自己主張的 low-cost intervention 範式——可關閉、零訓練改動、無商業成本

詳細引用、PDF 連結、system card 節選見 [RESEARCH.md](./RESEARCH.md)。

## License

MIT
