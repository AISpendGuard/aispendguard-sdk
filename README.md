# AISpendGuard SDK

The AISpendGuard SDK lets you send **tags-only AI usage events** to AISpendGuard
so you can:
- track AI spend
- attribute cost to features/routes/customers
- detect waste (wrong model, overuse)
- set budgets and receive alerts

🚫 The SDK **never sends prompt text or model outputs**.

---

## What the SDK Does

The SDK:
- wraps your AI provider calls (or runs alongside them)
- collects **observable metadata only**
- sends usage events to AISpendGuard’s ingestion API

Collected data:
- provider & model
- input/output token counts
- latency
- cost (if known)
- timestamp
- developer-defined tags (intent)

Not collected:
- prompts
- completions
- attachments
- tool outputs
- PII

---

## Supported Providers (MVP)

- OpenAI (first-class)
- Anthropic (estimated via SDK; optional)
- Others later

---

## Installation (Node.js / TypeScript)

```bash
npm install @aispendguard/sdk


Quick Start (Minimal)
import { trackUsage } from "@aispendguard/sdk";

await trackUsage({
  workspaceId: "ws_123",
  provider: "openai",
  model: "gpt-4o-mini",

  inputTokens: 120,
  outputTokens: 12,
  latencyMs: 840,
  costUsd: 0.0021,

  tags: {
    task_type: "classify",
    feature: "lead_classifier",
    route: "POST /api/ai/classify",
    customer_plan: "free",
    environment: "prod"
  }
});


This sends one usage event to AISpendGuard.

Recommended Integration Pattern
Recommended Integration Pattern
Wrap your AI call
const start = Date.now();

const result = await openai.responses.create({
  model: "gpt-4o-mini",
  input: "Classify this lead..."
});

await trackUsage({
  workspaceId,
  provider: "openai",
  model: "gpt-4o-mini",
  inputTokens: result.usage.input_tokens,
  outputTokens: result.usage.output_tokens,
  latencyMs: Date.now() - start,
  costUsd: estimateCost(result.usage, "gpt-4o-mini"),
  tags
});

AISpendGuard does not need to see the prompt to provide value.

Tags (Very Important)

Tags give context so AISpendGuard can detect waste and give advice.

Required Tags
tags: {
  task_type,
  feature,
  route,
  environment
}
Recommended Tags
tags: {
  customer_plan,   // free | pro | enterprise
  customer_id,     // internal ID only (no PII)
  agent_name       // if using agents
}
task_type Enum (Recommended)

classify

extract

summarize

rewrite

rag

chat_support

code

vision

agent

other

These enable “wrong model for job” detection.

Privacy & Security Guarantees

The SDK enforces:

❌ No prompt text

❌ No output text

❌ No files or attachments

❌ No user PII

If prompt data is detected, the SDK throws an error.

Cost Handling
If you know the cost

Send costUsd.

If you don’t

Send token counts only. AISpendGuard will:

estimate cost using model pricing

clearly label it as “estimated”

Error Handling

SDK failures never block your AI call

Usage events are best-effort

Errors are logged but swallowed by default

You can opt into strict mode if desired.

Configuration
configure({
  apiKey: process.env.AISPENDGUARD_API_KEY,
  endpoint: "https://api.aispendguard.com/ingest",
  strict: false
});
Proxy Mode (Future)

A future version may support:

proxy/gateway mode

hard spend caps

enforcement

This is opt-in and not required for MVP.

What This SDK Is NOT

Not an observability tracer

Not a prompt debugger

Not a model quality evaluator

Not a logging system

Its job is cost control, not content inspection.

Contributing

Do not add prompt or output fields

Follow the tags spec exactly

Privacy guarantees are non-negotiable

License

TBD


---

## 📌 Strong recommendation
Also add this file in the same repo:

**`tags-spec.md`**  
(to make privacy guarantees explicit and enforceable)

You already have a version in docs — this should mirror it.

---

If you want next, I can:
- scaffold the **actual Node SDK code**
- add **runtime guards** that reject prompt data
- design a **Python SDK**
- or write **integration examples for OpenAI & Anthropic**

Just tell me what’s next.