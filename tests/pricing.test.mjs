import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { estimateEventCost, BUNDLED_PRICES } = require("../dist/pricing.js");

function makeEvent(overrides) {
  return {
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 1000,
    outputTokens: 500,
    latencyMs: 100,
    timestamp: new Date().toISOString(),
    tags: { task_type: "chat", feature: "test", route: "test" },
    ...overrides,
  };
}

test("known model returns correct cost", () => {
  // gpt-4o: input $2.50/1M, output $10.00/1M
  // 1000 input + 500 output = (1000 * 2.50 + 500 * 10.00) / 1_000_000 = 0.0025 + 0.005 = 0.0075
  const cost = estimateEventCost(makeEvent({}));
  assert.ok(cost !== null);
  assert.equal(Math.round(cost * 1_000_000) / 1_000_000, 0.0075);
});

test("unknown model returns null", () => {
  const cost = estimateEventCost(makeEvent({ provider: "unknown", model: "nonexistent" }));
  assert.equal(cost, null);
});

test("costUsd override takes precedence", () => {
  const cost = estimateEventCost(makeEvent({ costUsd: 0.42 }));
  assert.equal(cost, 0.42);
});

test("costUsd = 0 is a valid override", () => {
  const cost = estimateEventCost(makeEvent({ costUsd: 0 }));
  assert.equal(cost, 0);
});

test("OpenAI cache read multiplier 0.5x for standard models", () => {
  // gpt-4o with 800 regular + 200 cached input
  // regular: 800 * 2.50 / 1M = 0.002
  // cached: 200 * 2.50 * 0.5 / 1M = 0.00025
  // output: 500 * 10.00 / 1M = 0.005
  // total = 0.00725
  const cost = estimateEventCost(makeEvent({ inputTokensCached: 200 }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.00725) < 0.000001);
});

test("OpenAI deep cache read multiplier 0.25x for gpt-4.1 models", () => {
  // gpt-4.1: input $2.00/1M, output $8.00/1M
  // 800 regular: 800 * 2.00 / 1M = 0.0016
  // 200 cached (0.25x): 200 * 2.00 * 0.25 / 1M = 0.0001
  // output: 500 * 8.00 / 1M = 0.004
  // total = 0.0057
  const cost = estimateEventCost(makeEvent({
    model: "gpt-4.1",
    inputTokensCached: 200,
  }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.0057) < 0.000001);
});

test("Anthropic cache read multiplier 0.1x", () => {
  // claude-sonnet-4-6: input $3.00/1M, output $15.00/1M
  // 800 regular: 800 * 3.00 / 1M = 0.0024
  // 200 cached (0.1x): 200 * 3.00 * 0.1 / 1M = 0.00006
  // output: 500 * 15.00 / 1M = 0.0075
  // total = 0.00996
  const cost = estimateEventCost(makeEvent({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokensCached: 200,
  }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.00996) < 0.000001);
});

test("Anthropic cache write multiplier 1.25x (default 5m)", () => {
  // claude-sonnet-4-6: input $3.00/1M
  // 800 regular: 800 * 3.00 / 1M = 0.0024
  // 200 cache write (1.25x): 200 * 3.00 * 1.25 / 1M = 0.00075
  // output: 500 * 15.00 / 1M = 0.0075
  // total = 0.01065
  const cost = estimateEventCost(makeEvent({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokensCacheWrite: 200,
  }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.01065) < 0.000001);
});

test("Anthropic cache write multiplier 2.0x (1h TTL)", () => {
  // 800 regular: 800 * 3.00 / 1M = 0.0024
  // 200 cache write (2.0x): 200 * 3.00 * 2.0 / 1M = 0.0012
  // output: 500 * 15.00 / 1M = 0.0075
  // total = 0.0111
  const cost = estimateEventCost(makeEvent({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokensCacheWrite: 200,
    cacheTtl: "1h",
  }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.0111) < 0.000001);
});

test("batch API applies 50% discount", () => {
  // Normal: 0.0075
  // Batch: 0.0075 * 0.5 = 0.00375
  const cost = estimateEventCost(makeEvent({ isBatchApi: true }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.00375) < 0.000001);
});

test("fast mode applies 6x multiplier", () => {
  // Normal: 0.0075
  // Fast: 0.0075 * 6 = 0.045
  const cost = estimateEventCost(makeEvent({ isFastMode: true }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.045) < 0.000001);
});

test("web search adds flat fee", () => {
  // Normal token cost: 0.0075
  // + 2 web searches * $0.01 = 0.02
  // total = 0.0275
  const cost = estimateEventCost(makeEvent({ webSearchCount: 2 }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.0275) < 0.000001);
});

test("custom pricing map overrides bundled pricing", () => {
  const custom = new Map([
    ["openai/gpt-4o", { provider: "openai", model: "gpt-4o", inputPer1MTokens: 5.00, outputPer1MTokens: 20.00 }],
  ]);
  // 1000 * 5.00 / 1M = 0.005
  // 500 * 20.00 / 1M = 0.01
  // total = 0.015
  const cost = estimateEventCost(makeEvent({}), custom);
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.015) < 0.000001);
});

test("bundled pricing table has entries for all major providers", () => {
  assert.ok(BUNDLED_PRICES.has("openai/gpt-4o"));
  assert.ok(BUNDLED_PRICES.has("anthropic/claude-sonnet-4-6"));
  assert.ok(BUNDLED_PRICES.has("google/gemini-2.5-pro"));
  assert.ok(BUNDLED_PRICES.has("mistral/mistral-large-latest"));
  assert.ok(BUNDLED_PRICES.has("cohere/command-a"));
  assert.ok(BUNDLED_PRICES.has("groq/llama-3.3-70b-versatile"));
});

test("Google Pro long-context surcharge applies above 200K tokens", () => {
  // gemini-2.5-pro: input $1.25/1M, output $10.00/1M
  // 250K input tokens (above 200K threshold): 2x multiplier
  // input: 250000 * 1.25 / 1M * 2.0 = 0.625
  // output: 500 * 10.00 / 1M * 2.0 = 0.01
  // total = 0.635
  const cost = estimateEventCost(makeEvent({
    provider: "google",
    model: "gemini-2.5-pro",
    inputTokens: 250000,
  }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.635) < 0.001);
});

test("Google Flash models exempt from long-context surcharge", () => {
  // gemini-2.5-flash: input $0.30/1M, output $2.50/1M
  // 250K input — no surcharge for Flash
  // input: 250000 * 0.30 / 1M = 0.075
  // output: 500 * 2.50 / 1M = 0.00125
  // total = 0.07625
  const cost = estimateEventCost(makeEvent({
    provider: "google",
    model: "gemini-2.5-flash",
    inputTokens: 250000,
  }));
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.07625) < 0.001);
});
