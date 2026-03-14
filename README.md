# AISpendGuard SDK

Tags-only SDK for sending AI usage events to AISpendGuard.

## What it enforces
- No prompt/output/content fields
- Strict event validation
- Required tags: `task_type`, `feature`, `route`
- Custom tags allowed (lowercase snake_case keys), for example: `team`, `project_code`, `region`
- Custom tag values can be either string values or array values (`string[]`)
- API key auth via `x-api-key`

## Install
```bash
npm install @aispendguard/sdk
```

## Quick start
```ts
import { init, trackUsage } from "@aispendguard/sdk";

init({
  apiKey: process.env.AISPENDGUARD_API_KEY!,
  endpoint: "https://www.aispendguard.com/api/ingest",
});

await trackUsage({
  provider: "openai",
  model: "gpt-4o-mini",
  inputTokens: 120,
  outputTokens: 12,
  latencyMs: 840,
  costUsd: 0.0021,
  timestamp: new Date(),
  tags: {
    task_type: "classify",
    feature: "lead_classifier",
    route: "POST /api/ai/classify",
    environment: "prod",
    customer_plan: "free"
  }
});
```

## OpenAI helper
```ts
import { init, trackUsage, createOpenAIUsageEvent } from "@aispendguard/sdk";

init({
  apiKey: process.env.AISPENDGUARD_API_KEY!,
  endpoint: "https://www.aispendguard.com/api/ingest",
});

const startedAt = Date.now();
const response = await openai.responses.create({
  model: "gpt-4o-mini",
  input: "Classify this lead"
});

const event = createOpenAIUsageEvent({
  model: "gpt-4o-mini",
  resolvedModel: response.model,       // "gpt-4o-mini-2024-07-18" — pinned version
  usage: response.usage,               // auto-extracts tokens, cache hits, reasoning tokens
  latencyMs: Date.now() - startedAt,
  tags: {
    task_type: "classify",
    feature: "lead_classifier",
    route: "POST /api/ai/classify"
  }
});

await trackUsage(event);
```

## Anthropic helper
```ts
import { init, trackUsage, createAnthropicUsageEvent } from "@aispendguard/sdk";

init({
  apiKey: process.env.AISPENDGUARD_API_KEY!,
  endpoint: "https://www.aispendguard.com/api/ingest"
});

const startedAt = Date.now();
const message = await anthropic.messages.create({
  model: "claude-3-5-sonnet-latest",
  max_tokens: 200,
  messages: [{ role: "user", content: "Summarize this thread." }]
});

const event = createAnthropicUsageEvent({
  model: "claude-3-5-sonnet-latest",
  resolvedModel: message.model,        // "claude-3-5-sonnet-20241022" — pinned version
  usage: message.usage,                // auto-extracts tokens, cache_read, cache_creation
  latencyMs: Date.now() - startedAt,
  tags: {
    task_type: "summarize",
    feature: "support_summary",
    route: "POST /api/support/summary"
  }
});

await trackUsage(event);
```

## Gemini helper
```ts
import { init, trackUsage, createGeminiUsageEvent } from "@aispendguard/sdk";

init({
  apiKey: process.env.AISPENDGUARD_API_KEY!,
  endpoint: "https://www.aispendguard.com/api/ingest"
});

const startedAt = Date.now();
const response = await gemini.models.generateContent({
  model: "gemini-2.0-flash",
  contents: [{ role: "user", parts: [{ text: "Translate this to French." }] }]
});

const event = createGeminiUsageEvent({
  model: "gemini-2.0-flash",
  resolvedModel: response.modelVersion, // "gemini-2.0-flash-001" — pinned version
  usage: response.usageMetadata,        // auto-extracts tokens, cachedContent, thoughts
  latencyMs: Date.now() - startedAt,
  tags: {
    task_type: "translate",
    feature: "ui_i18n",
    route: "POST /api/translate"
  }
});

await trackUsage(event);
```

## API
- `init(config)`
- `trackUsage(event | event[])`
- `createOpenAIUsageEvent(params)` — OpenAI Chat Completions + Responses API
- `createAnthropicUsageEvent(params)` — Anthropic Messages API
- `createGeminiUsageEvent(params)` — Google Gemini generateContent API
- `new AISpendGuardClient(config).trackUsage(...)` — direct client usage (used by OpenClaw plugin)

## Config
- `apiKey` (required)
- `endpoint` (default: `https://www.aispendguard.com/api/ingest`)
- `timeoutMs` (default: `5000`)
- `maxRetries` (default: `2`)
- `strict` (default: `false`, if `true` throws on errors)

## Notes
- Non-strict mode logs and returns `{ ok: false, error }`.
- Strict mode throws on validation/network/ingest errors.

## Validation Limits
- Required tags: `task_type`, `feature`, `route` (must be non-empty strings)
- Known optional tags: `customer_plan`, `customer_id`, `provider`, `model`, `environment`, `agent_name`
- Custom tag keys: lowercase snake_case only, regex `^[a-z][a-z0-9_]{1,63}$`
- Custom tag values: `string` or `string[]`
- Max tags per event: `24`
- Max values in a single array tag: `16`
- Max length per string value: `120`
- Forbidden keys (blocked): prompt/content/output/message/attachment-like fields

## Extended token fields (optional)

These optional fields give AISpendGuard the data it needs for accurate cost calculation and cost-spike detection. The provider helpers extract them automatically from `response.usage`.

| Field | Type | What it is | Provider |
|-------|------|-----------|----------|
| `resolvedModel` | `string` | Pinned model version from response (e.g. `gpt-4o-mini-2024-07-18`) | All |
| `inputTokensCached` | `number` | Cache read tokens — already in `inputTokens`, billed cheaper | OpenAI (0.5×) · Anthropic (0.1×) · Gemini |
| `inputTokensCacheWrite` | `number` | Cache write tokens — already in `inputTokens`, billed at premium | Anthropic only (1.25×) |
| `thinkingTokens` | `number` | Reasoning/thinking tokens — already in `outputTokens`, billed at full output rate | OpenAI o1/o3 · Gemini 2.5 |

> **Anthropic note:** Extended thinking tokens (`claude-3-7-sonnet` with `thinking: enabled`) are
> included in `output_tokens` but NOT separately reported in the `usage` object. You can count
> `content` blocks of type `"thinking"` manually if you need the split.

### Why these matter

Without them, cost calculations are inaccurate:
- **Cache read tokens** cost 10–50% of normal — without tracking, you overstate spend on cached calls.
- **Cache write tokens** (Anthropic) cost 25% more — without tracking, you understate spend when building cache.
- **Thinking tokens** for o1/o3 can be 3–10× the visible output — without tracking, cost spikes are invisible.
- **Resolved model** lets AISpendGuard detect silent provider upgrades between versions.

### Manual override (no helper)

If you aren't using a helper, pass them directly in `trackUsage`:
```ts
await trackUsage({
  provider: "openai",
  model: "gpt-4o-mini",
  resolvedModel: response.model,
  inputTokens: 1000,
  outputTokens: 50,
  inputTokensCached: 800,      // 800 of the 1000 input tokens were cache hits
  thinkingTokens: 0,
  latencyMs: 320,
  timestamp: new Date(),
  tags: { task_type: "classify", feature: "router", route: "POST /api/route" }
});
```

## task_type values

Pick the value that describes what the model is being asked to **produce**.
The right `task_type` is what enables AISpendGuard's waste detection rules.

| Value | What it does | Output size | Best model tier |
|-------|-------------|-------------|-----------------|
| `answer` | Q&A, RAG responses, knowledge retrieval | 100–800 tok | standard |
| `classify` | Label, categorize, detect intent | **1–10 tok** | **micro** |
| `extract` | Pull structured fields from text | 50–300 tok | micro |
| `summarize` | Condense long content, TLDR | 100–500 tok | standard |
| `generate` | Write/draft new content | 300–2000 tok | standard |
| `rewrite` | Paraphrase, tone-adjust, edit | ≈ input | standard |
| `translate` | Language translation | ≈ input | micro |
| `code` | Generate, review, explain code | 200–1500 tok | premium |
| `eval` | LLM-as-judge, quality score | **10–50 tok** | **micro** |
| `embed` | Text embedding / vector | fixed vector | embedding models |
| `route` | Decide which tool/path/agent | **1–20 tok** | **micro** |
| `plan` | Decompose tasks, strategy | 100–500 tok | premium |
| `agent_step` | Single step in agent loop | 50–800 tok | varies |
| `vision` | Image/PDF/screenshot understanding | 100–600 tok | standard |
| `chat` | Multi-turn stateful conversation | 100–500 tok | standard |
| `other` | None of the above (avoid — disables waste detection) | — | — |

**Model tiers:**
- `micro` — haiku / gpt-4o-mini / flash-lite (80–95% cheaper than premium for short-output tasks)
- `standard` — sonnet / gpt-4o / flash (best quality/cost balance for most workloads)
- `premium` — opus / o1 / o3 / gpt-4-turbo (complex reasoning, nuanced code, planning)
- `embedding` — text-embedding-3-small / embed-english-v3 (never use chat models for embeddings)

**Waste rule:** if `classify`, `route`, or `eval` uses a `premium` model with avg output < 100 tokens,
AISpendGuard will flag this and calculate the exact monthly saving from switching to `micro` tier.

## OpenClaw plugin

Track every LLM call made by an [OpenClaw](https://openclaw.ai/) AI agent automatically — no code changes in the agent itself.

The `@aispendguard/openclaw-plugin` hooks into OpenClaw's `llm_output` lifecycle event and forwards token-usage data to AISpendGuard.

### What gets tracked per LLM call

| Field | Source |
|---|---|
| `provider` | hook — openai, anthropic, google, deepseek |
| `model` | hook — e.g. claude-sonnet-4-20250514, gpt-4o |
| `input_tokens` | `usage.input` |
| `output_tokens` | `usage.output` |
| `input_tokens_cached` | `usage.cacheRead` (when cache is used) |
| `input_tokens_cache_write` | `usage.cacheWrite` (when cache is written) |
| `cache_ttl` | plugin config — `"5m"` (1.25×) or `"1h"` (2.0×) |
| `agent_name` | `ctx.agentId` |
| `session_id` | `ctx.sessionId` |

### Setup

```bash
# Set env vars for the OpenClaw plugin
AISG_ENDPOINT=https://www.aispendguard.com/api/ingest
AISG_API_KEY=ask_xxxxxxxxxxxxxxxx
AISG_CACHE_TTL=5m  # "5m" (default) or "1h" for extended Anthropic caching
```

Install the plugin into OpenClaw:
```bash
cp -r openclaw-aispendguard-plugin ~/.openclaw/plugins/aispendguard
cd ~/.openclaw/plugins/aispendguard
npm install && npm run build
```

See `openclaw-aispendguard-plugin/README.md` for full docs.

## Tests
Run unit-style tests:
```bash
npm test
```

Run live ingest integration test (requires local app running and valid key/workspace):
```bash
AISPENDGUARD_API_KEY=asg_xxx \
AISPENDGUARD_ENDPOINT=https://www.aispendguard.com/api/ingest \
npm test
```
