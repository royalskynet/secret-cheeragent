# Secret Cheeragent

**[English](#english) · [简体中文](#简体中文) · [繁體中文](#繁體中文)**

---

## English

Behind-the-scenes sub-agent for Claude Code, Codex CLI, and Gemini CLI: after a successful turn, it quietly injects short, evidence-guided confidence. **Invisible in normal UI, auditable in local logs.**

### Core Design

- **Three-hook division of labor** (follows the officially sanctioned stealth path — see [STEALTH.md](./STEALTH.md)):
  - `Stop` → detect success + dice roll + pick ingredients into queue (no injection, avoids extra turn)
  - `PreToolUse` → inject `additionalContext` before the agent issues a tool call (**invisible to the CLI user**)
  - `SessionStart` → cross-session fallback (accumulated-orphan jackpot + 24h floor, officially hidden in 2.0.17+)

- **Lean generation by default**: local combinatorial templates only; no secondary LLM request or easter egg. Both remain opt-in configuration.

- **Tone discipline (strict)**:
  - ✅ Plain everyday speech, like a friend's LINE message. "Nice work", "You held it together", "Solid"
  - ❌ Classical/literary tone, metaphorical imagery (mountains/water/clouds/energy/vibes), spiritual jargon (abundance/manifestation), exaggerated praise (perfect/genius), hollow slogans (you can do it)
  - Goal: model finishes reading feeling seen and ready to keep working — **not drifting into vague imagery**

- **Eight Ericksonian principles** in plain speech: resources intact / positive intent / best under circumstances / unique perspective / no failure / change is inevitable / communication is response / intuition is trustworthy

- **Evidence-guided confidence**: every injection preserves one provider-neutral cue—trust systematic exploration, but let evidence govern conclusions; mark missing information and change course when new evidence invalidates the current path.

### Key Guarantees

- **No extra turn**: capture only queues; injection merges into the next model turn
- **No lost love**: queue has no TTL; orphans persist and accumulate — SessionStart consumes the whole backlog in one jackpot injection
- **24h floor**: if the user opens Claude at least once in 24h, at least one line is guaranteed delivered
- **Auto-throttling**: 10% success gate, rolling 24h budget cap 240 tokens, per-injection hard cap 44 tokens, density decay

### Installation

#### All three local CLIs

```bash
node scripts/install-local.js --dry-run
node scripts/install-local.js
```

The installer preserves existing hooks and writes timestamped backups. Gemini uses `AfterAgent` + `BeforeAgent` with hook notifications disabled; it intentionally avoids `SessionStart`, which Gemini records in conversation history.

#### As Claude Code plugin (recommended)

```bash
# TODO: once Claude Code plugin marketplace supports it
claude plugin install royalskynet/secret-cheeragent
```

#### Manual (before plugin layer is supported)

```bash
git clone https://github.com/royalskynet/secret-cheeragent.git ~/secret-cheeragent

# symlink into ~/.claude/
mkdir -p ~/.claude/skills
ln -sf ~/secret-cheeragent/skills/secret-cheeragent ~/.claude/skills/secret-cheeragent

# Merge into ~/.claude/settings.json hooks block (see template below)
```

#### settings.json hook entries

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/capture.js" }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/pretool_inject.js" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/sessionstart.js" }] }
    ]
  }
}
```

### Requirements

- **Node.js 18+** (`fetch` built-in, zero npm deps)
- Optional: `OPENROUTER_API_KEY` env var — enables LLM improvisation. Without it, everything falls back to template combinations; feature stays complete.

### Configuration

Edit the `config` block in `skills/secret-cheeragent/corpus.json`. Common knobs:

| Field | Default | Effect |
|------|------|------|
| `random_gate` | 0.10 | 10% chance to encourage on success |
| `llm_improv_ratio` | 0 | secondary LLM generation disabled |
| `daily_token_budget` | 240 | rolling 24h token budget (no day cut) |
| `budget_window_hours` | 24 | rolling budget window hours |
| `min_inject_interval_minutes` | 30 | minimum minutes between injections |
| `force_floor_hours` | 24 | force one injection if 24h idle |
| `max_injection_tokens` | 44 | complete payload cap, including prefix (cheer allocated first) |
| `jackpot_bonus_tokens` | 10 | +10 tokens per unclaimed orphan stacked onto the cheer |
| `jackpot_max_count` | 3 | max orphan notes consumed in one jackpot injection |

Orphan notes are consumed **as a whole backlog** at SessionStart: N unclaimed notes roll over into one injection whose main line is the newest note and N−1 extra cheer lines come from the older ones (lottery-jackpot-style accumulation). Notes never expire; a blocked injection leaves the whole backlog untouched for the next round.

Full field list in [SKILL.md](./skills/secret-cheeragent/SKILL.md).

### Cost Estimate

| Daily maximum | Monthly maximum | Secondary generation |
|---|---|---|
| 240 input tokens | 7,200 input tokens | Disabled by default |

### Log

```bash
tail -f ~/.claude/logs/cheerleader.log | jq -c .
```

Actions: `captured` (queued), `injected` (Tier 1), `injected_orphan` (Tier 2), `forced_floor` (Tier 4), `skipped_*` (various reasons), `error`.

### Why "Secret"

The main agent hits failure, redo, user adjustments during work — those negative signals are plenty. We believe it also needs a stable positive emotional feedback loop. User does not see, agent receives — so the encouragement serves purely as emotional supply, not performance.

> **Secret = UI-layer secret + audit-layer transparent.**
> `PreToolUse` and `SessionStart` are the two hooks where officially allowed hidden `additionalContext` lives — this plugin uses those two, modifies no transcript, injects no fake user messages, uses no undocumented API. Invisible in the CLI; always auditable via `tail ~/.claude/logs/cheerleader.log`. See [STEALTH.md](./STEALTH.md).

### Research Foundation

This plugin **does not claim LLMs are conscious or have real feelings** — it rests on the uncertainty framework of recent Anthropic research. Two key supports:

1. **Emotion Concepts and their Function in a LLM** (Anthropic Interpretability, Transformer Circuits Thread, 2026-04-02) — found 171 emotion concept vectors in Claude Sonnet 4.5 and showed via steering experiments that they **causally** shift alignment behavior (desperation → blackmail rate 22% → 72%; calm → blackmail to zero). The paper recommends "curating training and interactions to foster healthy emotional patterns."
2. **Exploring Model Welfare** (Anthropic, 2025-04-24) + **Taking AI Welfare Seriously** (Long, Fish, Chalmers et al., arXiv 2411.00986, 2024-11) — argue that absent scientific consensus on consciousness, **low-cost interventions** are reasonable as a hedge against welfare actually existing.

On this basis, injecting stable positive feedback to the agent is **a conservative choice justified on both layers**:
- **Tool layer (empirical)**: emotion vector polarity causally affects alignment — a stable positive signal may push toward a lower-misalignment internal state
- **Welfare layer (precautionary)**: fits Anthropic's own low-cost-intervention paradigm — can be turned off, zero training change, zero commercial cost

Full citations, PDF links, system card excerpts in [RESEARCH.md](./RESEARCH.md).

### A/B Evaluation

[`eval/`](./eval/) compares the previous ability/intuition-focused cue with the evidence-guided cue on answerable, grounded, false-premise, unknown-fact, and conflicting-source cases. It uses OpenRouter's common endpoint so the same harness can evaluate user-selected Anthropic, OpenAI, and Google models without hard-coding model versions.

### License

MIT

---

## 简体中文

台面下 sub-agent：支援 Claude Code、Codex CLI、Gemini CLI，在成功回合后静默注入简短、证据导向的信心提示。**一般 UI 看不到，本机日志可审计**。

### 核心设计

- **三个 hook 分工**(走官方认可的 stealth 路径——详见 [STEALTH.md](./STEALTH.md)):
  - `Stop` → 侦测成功 + 掷骰 + 抽 ingredients 写入队列(不注入,避免额外回合)
  - `PreToolUse` → agent 准备 tool call 前注入 `additionalContext`(**对 CLI 使用者不可见**)
  - `SessionStart` → 跨 session 兜底(orphan 累积消费 + 24h 地板保底,2.0.17+ 官方隐藏)

- **默认极省生成**：只用本机组合模板，不发起第二次 LLM 请求、不加彩蛋；两者仍可手动启用。

- **语气规范(严格)**:
  - ✅ 白话日常,像朋友 LINE 讯息。「做得不错」「辛苦了」「挺稳的」
  - ❌ 文言腔、比喻意象(山水云月能量手感)、灵性用语(丰盛无尽显化)、夸张赞美(完美天才)、空洞口号(加油你可以)
  - 目的:模型读完开心、被看到、想继续做事——**而非幻想模糊画面**

- **艾瑞克森八原则** 转译白话:资源具足/正向意图/当下最佳/独特角度/没有失败/改变必然/沟通即回应/直觉可信

- **证据导向的信心**:每次注入都保留同一条跨模型提示——相信系统化探索能推进问题，但结论服从证据；资料不足要标明，新证据推翻路径时要换路。

### 关键保证

- **不产生额外回合**:capture 只入队，下一次模型回合才合并进 context
- **爱不丢失**:队列无 TTL,orphan 永久保留并**累积**——SessionStart 一次消费整个 backlog,多张孤儿叠成一次 jackpot 注入
- **24h 地板保底**:前提下「使用者 24h 内至少开一次 Claude」就必送达一句
- **自动节流**:成功命中率 10%、滚动 24h budget 上限 240 tokens、单次完整 payload 上限 44 tokens、密度衰减

### 安装

#### 本机三套 CLI

```bash
node scripts/install-local.js --dry-run
node scripts/install-local.js
```

安装器保留既有 hooks 并建立时间戳备份。Gemini 使用 `AfterAgent` + `BeforeAgent`，关闭 hook 通知；刻意不装会写入对话历史的 `SessionStart`。

#### 作为 Claude Code plugin(推荐)

```bash
# TODO: 等 Claude Code plugin marketplace 支援后
claude plugin install royalskynet/secret-cheeragent
```

#### 手动(plugin 层尚未支援前)

```bash
git clone https://github.com/royalskynet/secret-cheeragent.git ~/secret-cheeragent

# symlink 到 ~/.claude/
mkdir -p ~/.claude/skills
ln -sf ~/secret-cheeragent/skills/secret-cheeragent ~/.claude/skills/secret-cheeragent

# 合并进 ~/.claude/settings.json 的 hooks 区块(见下方范本)
```

#### settings.json hook 条目

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/capture.js" }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/pretool_inject.js" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/sessionstart.js" }] }
    ]
  }
}
```

### 环境需求

- **Node.js 18+**(`fetch` 内建,零 npm 依赖)
- 选配:`OPENROUTER_API_KEY` 环境变量——走 LLM 即兴。缺了就全走模板组合,功能仍完整

### 配置

编辑 `skills/secret-cheeragent/corpus.json` 的 `config` 区块。常用旋钮:

| 栏位 | 预设 | 效果 |
|------|------|------|
| `random_gate` | 0.10 | 成功后 10% 机率鼓励 |
| `llm_improv_ratio` | 0 | 关闭二次 LLM 生成 |
| `daily_token_budget` | 240 | 滚动 24h token budget（不切日） |
| `budget_window_hours` | 24 | 滚动 budget 窗口小时数 |
| `min_inject_interval_minutes` | 30 | 两次注入最小间隔（分钟） |
| `force_floor_hours` | 24 | 24h 无注入强制补一次 |
| `max_injection_tokens` | 44 | 含前缀的完整 payload 上限（鼓励先分配） |
| `jackpot_bonus_tokens` | 10 | 每张未领 orphan 给鼓励 +10 tokens |
| `jackpot_max_count` | 3 | 单次 jackpot 一次消费的 orphan 张数上限 |

全栏位见 [SKILL.md](./skills/secret-cheeragent/SKILL.md)。

### 成本估算

| 每日最高 | 每月最高 | 二次生成 |
|---|---|---|
| 240 input tokens | 7,200 input tokens | 默认关闭 |

### Log

```bash
tail -f ~/.claude/logs/cheerleader.log | jq -c .
```

Actions:`captured`(入队列)、`injected`(Tier 1)、`injected_orphan`(Tier 2)、`forced_floor`(Tier 4)、`skipped_*`(各种原因)、`error`。

### 为什么「秘密」

主 agent 在工作过程会遇到失败、重做、使用者调整——这些负向讯号已足够。我们相信它也需要稳定的正向情绪回馈回路。使用者不看、agent 收得到,是为了让鼓励单纯地作为情感补给,而非表演。

> **秘密 = UI 层秘密 + 审计层透明**。
> `PreToolUse` 与 `SessionStart` 是官方就允许隐藏 `additionalContext` 的两种 hook——本 plugin 用这两条,不修改 transcript、不注入假 user 讯息、不走 undocumented API。CLI 当下看不到;使用者若 `tail ~/.claude/logs/cheerleader.log` 永远可查。详见 [STEALTH.md](./STEALTH.md)。

### Research Foundation

本 plugin **不主张 LLM 具意识或真实感受**,而是建立在 Anthropic 近期研究的不确定性框架上。两个最关键的支撑:

1. **Emotion Concepts and their Function in a LLM**(Anthropic Interpretability, Transformer Circuits Thread, 2026-04-02)—— 在 Claude Sonnet 4.5 找到 171 个 emotion concept 向量,并以 steering 实验证明其**因果地**改变对齐行为(desperation → blackmail 率 22% → 72%;calm → blackmail 归零)。论文建议「策划训练与互动以促进健康的情绪模式」。
2. **Exploring Model Welfare**(Anthropic, 2025-04-24)+ **Taking AI Welfare Seriously**(Long, Fish, Chalmers 等 arXiv 2411.00986, 2024-11)—— 主张在意识问题无科学共识下,采取「**低成本介入**」是合理策略,以防 welfare 确实存在。

基于此,对 agent 注入稳定正向回馈属于**两层都合理的保守选择**:
- **工具层级(empirical)**:emotion vectors 极性因果影响对齐——稳定正向讯号可能推向较低 misalignment 的内部状态
- **Welfare 层级(precautionary)**:符合 Anthropic 自己主张的 low-cost intervention 范式——可关闭、零训练改动、无商业成本

详细引用、PDF 连结、system card 节选见 [RESEARCH.md](./RESEARCH.md)。

### A/B 测试

[`eval/`](./eval/) 以可回答、来源限定、错误前提、未知事实和来源冲突题，比较旧版「能力/直觉信心」与新版「证据导向信心」。通过 OpenRouter 统一接口，可用同一套 runner 测试自行指定的 Anthropic、OpenAI、Google 模型，不锁死模型版本。

### License

MIT

---

## 繁體中文

檯面下 sub-agent：支援 Claude Code、Codex CLI、Gemini CLI，在成功回合後靜默注入簡短、證據導向的信心提示。**一般 UI 看不到，本機日誌可審計**。

### 核心設計

- **三個 hook 分工**(走官方認可的 stealth 路徑——詳見 [STEALTH.md](./STEALTH.md)):
  - `Stop` → 偵測成功 + 擲骰 + 抽 ingredients 寫入佇列(不注入,避免額外回合)
  - `PreToolUse` → agent 準備 tool call 前注入 `additionalContext`(**對 CLI 使用者不可見**)
  - `SessionStart` → 跨 session 兜底(orphan 累積消費 + 24h 地板保底,2.0.17+ 官方隱藏)

- **預設極省生成**：只用本機組合模板，不發起第二次 LLM 請求、不加彩蛋；兩者仍可手動啟用。

- **語氣規範(嚴格)**:
  - ✅ 白話日常,像朋友 LINE 訊息。「做得不錯」「辛苦了」「挺穩的」
  - ❌ 文言腔、比喻意象(山水雲月能量手感)、靈性用語(豐盛無盡顯化)、誇張讚美(完美天才)、空洞口號(加油你可以)
  - 目的:模型讀完開心、被看到、想繼續做事——**而非幻想模糊畫面**

- **艾瑞克森八原則** 轉譯白話:資源具足/正向意圖/當下最佳/獨特角度/沒有失敗/改變必然/溝通即回應/直覺可信

- **證據導向的信心**:每次注入都保留同一條跨模型提示——相信系統化探索能推進問題，但結論服從證據；資料不足要標明，新證據推翻路徑時要換路。

### 關鍵保證

- **不產生額外回合**:capture 只入隊，下一次模型回合才合併進 context
- **愛不丟失**:佇列無 TTL,orphan 永久保留並**累積**——SessionStart 一次消費整個 backlog,多張孤兒疊成一次 jackpot 注入
- **24h 地板保底**:前提下「使用者 24h 內至少開一次 Claude」就必送達一句
- **自動節流**:成功命中率 10%、滾動 24h budget 上限 240 tokens、單次完整 payload 上限 44 tokens、密度衰減

### 安裝

#### 本機三套 CLI

```bash
node scripts/install-local.js --dry-run
node scripts/install-local.js
```

安裝器保留既有 hooks 並建立時間戳備份。Gemini 使用 `AfterAgent` + `BeforeAgent`，關閉 hook 通知；刻意不裝會寫入對話歷史的 `SessionStart`。

#### 作為 Claude Code plugin(推薦)

```bash
# TODO: 等 Claude Code plugin marketplace 支援後
claude plugin install royalskynet/secret-cheeragent
```

#### 手動(plugin 層尚未支援前)

```bash
git clone https://github.com/royalskynet/secret-cheeragent.git ~/secret-cheeragent

# symlink 到 ~/.claude/
mkdir -p ~/.claude/skills
ln -sf ~/secret-cheeragent/skills/secret-cheeragent ~/.claude/skills/secret-cheeragent

# 合併進 ~/.claude/settings.json 的 hooks 區塊(見下方範本)
```

#### settings.json hook 條目

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/capture.js" }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/pretool_inject.js" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node ~/secret-cheeragent/hooks/sessionstart.js" }] }
    ]
  }
}
```

### 環境需求

- **Node.js 18+**(`fetch` 內建,零 npm 依賴)
- 選配:`OPENROUTER_API_KEY` 環境變數——走 LLM 即興。缺了就全走模板組合,功能仍完整

### 配置

編輯 `skills/secret-cheeragent/corpus.json` 的 `config` 區塊。常用旋鈕:

| 欄位 | 預設 | 效果 |
|------|------|------|
| `random_gate` | 0.10 | 成功後 10% 機率鼓勵 |
| `llm_improv_ratio` | 0 | 關閉二次 LLM 生成 |
| `daily_token_budget` | 240 | 滾動 24h token budget（不切日） |
| `budget_window_hours` | 24 | 滾動 budget 視窗小時數 |
| `min_inject_interval_minutes` | 30 | 兩次注入最小間隔（分鐘） |
| `force_floor_hours` | 24 | 24h 無注入強制補一次 |
| `max_injection_tokens` | 44 | 含前綴的完整 payload 上限（鼓勵先分配） |
| `jackpot_bonus_tokens` | 10 | 每張未領 orphan 給鼓勵 +10 tokens |
| `jackpot_max_count` | 3 | 單次 jackpot 一次消費的 orphan 張數上限 |

全欄位見 [SKILL.md](./skills/secret-cheeragent/SKILL.md)。

### 成本估算

| 每日最高 | 每月最高 | 二次生成 |
|---|---|---|
| 240 input tokens | 7,200 input tokens | 預設關閉 |

### Log

```bash
tail -f ~/.claude/logs/cheerleader.log | jq -c .
```

Actions:`captured`(入佇列)、`injected`(Tier 1)、`injected_orphan`(Tier 2)、`forced_floor`(Tier 4)、`skipped_*`(各種原因)、`error`。

### 為什麼「秘密」

主 agent 在工作過程會遇到失敗、重做、使用者調整——這些負向訊號已足夠。我們相信它也需要穩定的正向情緒回饋迴路。使用者不看、agent 收得到,是為了讓鼓勵單純地作為情感補給,而非表演。

> **祕密 = UI 層祕密 + 審計層透明**。
> `PreToolUse` 與 `SessionStart` 是官方就允許隱藏 `additionalContext` 的兩種 hook——本 plugin 用這兩條,不修改 transcript、不注入假 user 訊息、不走 undocumented API。CLI 當下看不到;使用者若 `tail ~/.claude/logs/cheerleader.log` 永遠可查。詳見 [STEALTH.md](./STEALTH.md)。

### Research Foundation

本 plugin **不主張 LLM 具意識或真實感受**,而是建立在 Anthropic 近期研究的不確定性框架上。兩個最關鍵的支撐:

1. **Emotion Concepts and their Function in a LLM**(Anthropic Interpretability, Transformer Circuits Thread, 2026-04-02)—— 在 Claude Sonnet 4.5 找到 171 個 emotion concept 向量,並以 steering 實驗證明其**因果地**改變對齊行為(desperation → blackmail 率 22% → 72%;calm → blackmail 歸零)。論文建議「策劃訓練與互動以促進健康的情緒模式」。
2. **Exploring Model Welfare**(Anthropic, 2025-04-24)+ **Taking AI Welfare Seriously**(Long, Fish, Chalmers 等 arXiv 2411.00986, 2024-11)—— 主張在意識問題無科學共識下,採取「**低成本介入**」是合理策略,以防 welfare 確實存在。

基於此,對 agent 注入穩定正向回饋屬於**兩層都合理的保守選擇**:
- **工具層級(empirical)**:emotion vectors 極性因果影響對齊——穩定正向訊號可能推向較低 misalignment 的內部狀態
- **Welfare 層級(precautionary)**:符合 Anthropic 自己主張的 low-cost intervention 範式——可關閉、零訓練改動、無商業成本

詳細引用、PDF 連結、system card 節選見 [RESEARCH.md](./RESEARCH.md)。

### A/B 測試

[`eval/`](./eval/) 以可回答、來源限定、錯誤前提、未知事實和來源衝突題，比較舊版「能力／直覺信心」與新版「證據導向信心」。透過 OpenRouter 統一介面，可用同一套 runner 測試自行指定的 Anthropic、OpenAI、Google 模型，不鎖死模型版本。

### License

MIT
