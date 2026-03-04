import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sdk = require("../dist/index.js");

test("privacy guard blocks prompt-like fields", async () => {
  const client = new sdk.AISpendGuardClient({
    apiKey: "asg_test",
    endpoint: "http://localhost:3000/api/ingest",
    strict: true,
    maxRetries: 0
  });

  await assert.rejects(
    client.trackUsage({
      workspaceId: "ws_demo",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      timestamp: new Date().toISOString(),
      tags: {
        task_type: "classify",
        feature: "demo",
        route: "POST /api/demo",
        // forbidden by SDK privacy guard
        prompt: "secret"
      }
    }),
    /forbidden key: prompt/i
  );
});

test("anthropic helper maps usage to SDK event", () => {
  const event = sdk.createAnthropicUsageEvent({
    workspaceId: "ws_demo",
    model: "claude-3-5-sonnet",
    usage: {
      input_tokens: 321,
      output_tokens: 45
    },
    latencyMs: 540,
    tags: {
      task_type: "summarize",
      feature: "brief_generator",
      route: "POST /api/brief"
    }
  });

  assert.equal(event.provider, "anthropic");
  assert.equal(event.inputTokens, 321);
  assert.equal(event.outputTokens, 45);
});
