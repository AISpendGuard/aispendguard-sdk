import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sdk = require("../dist/index.js");

// --- createVercelAIUsageEvent tests ---

test("createVercelAIUsageEvent — happy path with full result", () => {
  const result = {
    usage: { promptTokens: 100, completionTokens: 50 },
    response: {
      modelId: "gpt-4o",
      timestamp: new Date(Date.now() - 500),
    },
    finishReason: "stop",
  };

  const event = sdk.createVercelAIUsageEvent(result);

  assert.equal(event.provider, "openai");
  assert.equal(event.model, "gpt-4o");
  assert.equal(event.inputTokens, 100);
  assert.equal(event.outputTokens, 50);
  assert.ok(event.latencyMs >= 0, "latencyMs should be non-negative");
  assert.equal(event.tags.source, "vercel-ai");
  assert.equal(event.tags.provider, "openai");
  assert.equal(event.tags.model, "gpt-4o");
});

test("createVercelAIUsageEvent — provider detection: openai models", () => {
  for (const modelId of ["gpt-4o", "gpt-3.5-turbo", "o1-preview", "o3-mini", "o4-mini"]) {
    const result = {
      usage: { promptTokens: 1, completionTokens: 1 },
      response: { modelId },
    };
    const event = sdk.createVercelAIUsageEvent(result);
    assert.equal(event.provider, "openai", `Expected openai for ${modelId}`);
  }
});

test("createVercelAIUsageEvent — provider detection: anthropic", () => {
  const result = {
    usage: { promptTokens: 1, completionTokens: 1 },
    response: { modelId: "claude-3-opus" },
  };
  const event = sdk.createVercelAIUsageEvent(result);
  assert.equal(event.provider, "anthropic");
});

test("createVercelAIUsageEvent — provider detection: google", () => {
  const result = {
    usage: { promptTokens: 1, completionTokens: 1 },
    response: { modelId: "gemini-pro" },
  };
  const event = sdk.createVercelAIUsageEvent(result);
  assert.equal(event.provider, "google");
});

test("createVercelAIUsageEvent — provider detection: unknown model", () => {
  const result = {
    usage: { promptTokens: 1, completionTokens: 1 },
    response: { modelId: "llama-3-70b" },
  };
  const event = sdk.createVercelAIUsageEvent(result);
  assert.equal(event.provider, "unknown");
});

test("createVercelAIUsageEvent — missing modelId falls back to 'unknown'", () => {
  const result = {
    usage: { promptTokens: 10, completionTokens: 5 },
    response: {},
  };
  const event = sdk.createVercelAIUsageEvent(result);
  assert.equal(event.model, "unknown");
  assert.equal(event.provider, "unknown");
});

test("createVercelAIUsageEvent — missing timestamp results in latencyMs = 0", () => {
  const result = {
    usage: { promptTokens: 10, completionTokens: 5 },
    response: { modelId: "gpt-4o" },
  };
  const event = sdk.createVercelAIUsageEvent(result);
  assert.equal(event.latencyMs, 0);
});

test("createVercelAIUsageEvent — future timestamp results in latencyMs = 0", () => {
  const result = {
    usage: { promptTokens: 10, completionTokens: 5 },
    response: {
      modelId: "gpt-4o",
      timestamp: new Date(Date.now() + 10000),
    },
  };
  const event = sdk.createVercelAIUsageEvent(result);
  assert.equal(event.latencyMs, 0);
});

test("createVercelAIUsageEvent — custom config overrides provider and merges tags", () => {
  const result = {
    usage: { promptTokens: 10, completionTokens: 5 },
    response: { modelId: "gpt-4o" },
  };
  const config = {
    provider: "azure",
    defaultTags: { feature: "summarize", task_type: "generation" },
  };
  const event = sdk.createVercelAIUsageEvent(result, config);
  assert.equal(event.provider, "azure");
  assert.equal(event.tags.feature, "summarize");
  assert.equal(event.tags.task_type, "generation");
  assert.equal(event.tags.source, "vercel-ai");
});

// --- createAISDKOnFinish tests ---

test("createAISDKOnFinish — calls trackUsage on initialized client", () => {
  let capturedEvent = null;
  const client = new sdk.AISpendGuardClient({
    apiKey: "asg_test",
    endpoint: "http://localhost:3000/api/ingest",
    maxRetries: 0,
  });
  const originalTrack = client.trackUsage.bind(client);
  client.trackUsage = (events) => {
    capturedEvent = events;
    return Promise.resolve({ ok: true, response: { accepted: 1, duplicates: 0, rejected: 0 } });
  };

  // Initialize SDK with our mock client
  sdk.init({
    apiKey: "asg_test",
    endpoint: "http://localhost:3000/api/ingest",
    maxRetries: 0,
  });
  // Replace the client's trackUsage after init
  const realClient = sdk.getClient();
  realClient.trackUsage = client.trackUsage;

  const onFinish = sdk.createAISDKOnFinish({ defaultTags: { feature: "chat" } });
  const result = {
    usage: { promptTokens: 200, completionTokens: 100 },
    response: { modelId: "gpt-4o" },
  };

  onFinish(result);

  assert.ok(capturedEvent !== null, "trackUsage should have been called");
  assert.equal(capturedEvent.model, "gpt-4o");
  assert.equal(capturedEvent.inputTokens, 200);
  assert.equal(capturedEvent.outputTokens, 100);
  assert.equal(capturedEvent.tags.feature, "chat");
});

test("createAISDKOnFinish — fire-and-forget: does not throw on trackUsage failure", () => {
  sdk.init({
    apiKey: "asg_test",
    endpoint: "http://localhost:3000/api/ingest",
    maxRetries: 0,
  });
  const realClient = sdk.getClient();
  realClient.trackUsage = () => {
    throw new Error("Network error");
  };

  const onFinish = sdk.createAISDKOnFinish();
  const result = {
    usage: { promptTokens: 10, completionTokens: 5 },
    response: { modelId: "gpt-4o" },
  };

  // Should not throw
  assert.doesNotThrow(() => onFinish(result));
});

// --- Privacy tests ---

test("privacy — callback does not access text, toolCalls, toolResults, or object", () => {
  sdk.init({
    apiKey: "asg_test",
    endpoint: "http://localhost:3000/api/ingest",
    maxRetries: 0,
  });
  const realClient = sdk.getClient();
  realClient.trackUsage = () => Promise.resolve({ ok: true, response: { accepted: 1, duplicates: 0, rejected: 0 } });

  const result = {
    usage: { promptTokens: 10, completionTokens: 5 },
    response: { modelId: "gpt-4o" },
  };

  // Add getter traps that throw if accessed
  let accessed = [];
  for (const key of ["text", "toolCalls", "toolResults", "object", "rawResponse"]) {
    Object.defineProperty(result, key, {
      get() {
        accessed.push(key);
        throw new Error(`Privacy violation: accessed result.${key}`);
      },
      configurable: true,
    });
  }

  const onFinish = sdk.createAISDKOnFinish();
  onFinish(result);

  assert.deepEqual(accessed, [], "No privacy-sensitive fields should be accessed");
});

test("privacy — createVercelAIUsageEvent does not access content fields", () => {
  const result = {
    usage: { promptTokens: 10, completionTokens: 5 },
    response: { modelId: "gpt-4o" },
  };

  let accessed = [];
  for (const key of ["text", "toolCalls", "toolResults", "object", "rawResponse"]) {
    Object.defineProperty(result, key, {
      get() {
        accessed.push(key);
        throw new Error(`Privacy violation: accessed result.${key}`);
      },
      configurable: true,
    });
  }

  const event = sdk.createVercelAIUsageEvent(result);

  assert.deepEqual(accessed, [], "No privacy-sensitive fields should be accessed");
  assert.ok(event.provider);
  assert.ok(event.model);
});
