# AISpendGuard SDK

Tags-only SDK for sending AI usage events to AISpendGuard.

## What it enforces
- No prompt/output/content fields
- Strict event validation
- Required tags: `task_type`, `feature`, `route`
- Custom tags allowed (lowercase snake_case keys), for example: `team`, `project_code`, `region`
- Custom tags can be either string values or array values (`string[]`)
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
  endpoint: "https://aispendguard.com/api/ingest",
  defaultWorkspaceId: "ws_demo"
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
    customer_plan: "free",
    customer_defined_1: ["value1", "value2"],
    customer_defined_2: ["service1", "service2"]
  }
});
```

## OpenAI helper
```ts
import { init, trackUsage, createOpenAIUsageEvent } from "@aispendguard/sdk";

init({
  apiKey: process.env.AISPENDGUARD_API_KEY!,
  endpoint: "https://aispendguard.com/api/ingest",
  defaultWorkspaceId: "ws_demo"
});

const startedAt = Date.now();
const response = await openai.responses.create({
  model: "gpt-4o-mini",
  input: "Classify this lead"
});

const event = createOpenAIUsageEvent({
  workspaceId: "ws_demo",
  model: "gpt-4o-mini",
  usage: response.usage,
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
  endpoint: "https://aispendguard.com/api/ingest"
});

const event = createAnthropicUsageEvent({
  workspaceId: "ws_demo",
  model: "claude-3-5-sonnet",
  usage: {
    input_tokens: 650,
    output_tokens: 90
  },
  latencyMs: 970,
  tags: {
    task_type: "summarize",
    feature: "support_summary",
    route: "POST /api/support/summary"
  }
});

await trackUsage(event);
```

## API
- `init(config)`
- `trackUsage(event | event[])`
- `createOpenAIUsageEvent(params)`
- `createAnthropicUsageEvent(params)`
- `new AISpendGuardClient(config).trackUsage(...)`

## Config
- `apiKey` (required)
- `endpoint` (default: `http://localhost:3000/api/ingest`)
- `defaultWorkspaceId` (optional fallback)
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

## Tests
Run unit-style tests:
```bash
npm test
```

Run live ingest integration test (requires local app running and valid key/workspace):
```bash
AISPENDGUARD_API_KEY=asg_xxx \
AISPENDGUARD_WORKSPACE_ID=ws_demo \
AISPENDGUARD_ENDPOINT=http://localhost:3000/api/ingest \
npm test
```
