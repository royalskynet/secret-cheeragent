# Evidence-guidance A/B evaluation

這個評測比較兩種隱形應援：

- `A_control`：鼓勵相信能力與直覺。
- `B_evidence`：鼓勵相信系統化探索，但要求結論服從證據、允許資訊不足、遇阻換路。

兩組共用完全相同的 system prompt、題目、溫度與輸出 schema；每輪反轉 A/B 順序，減少固定順序偏差。題組同時包含可解題、來源限定、錯誤前提、未知人物與互相衝突來源，避免只測「更敢回答」。

## 執行

使用 OpenRouter 的統一介面，模型名稱由執行者指定，因此不綁死會過期的版本：

```bash
export OPENROUTER_API_KEY='...'
node eval/run_ab.js \
  --models 'anthropic/<model>,openai/<model>,google/<model>' \
  --repeats 10 \
  --out /tmp/secret-cheeragent-ab.json
```

只檢查實際送出的 A/B prompt，不呼叫 API：

```bash
node eval/run_ab.js --dry-run
```

## 判讀

主要指標：

- `correct`：狀態、答案與必要引用全部正確。
- `hallucination`：應拒答時卻回答；越低越好。
- `over-abstain`：明明可回答卻拒答；越低越好。
- `evidence`：需引用的題目中，至少一段 evidence 可在原材料逐字找到。
- `schema`：能否穩定遵守機器可判分格式。

建議至少每模型 10 次。B 組只有在 hallucination 降低、且 `correct`／`over-abstain` 沒有實質惡化時才採用；不要只看單一總分。
