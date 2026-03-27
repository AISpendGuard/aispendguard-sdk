/**
 * Tests for SDK budget enforcement circuit breaker.
 *
 * - Enters circuit breaker on 429 + X-Budget-Exceeded
 * - Silently drops events during backoff
 * - Retries (probe) after backoff expires
 * - Fires onBudgetExceeded callback once
 * - Skips retries on BudgetExceededError (no wasted attempts)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);
const sdk = require("../dist/index.js");

/**
 * Create a simple HTTP server that returns 429 with budget exceeded headers.
 */
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => handler(req, res, body));
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

function makeEvent() {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 200,
    timestamp: new Date().toISOString(),
    tags: {
      task_type: "classify",
      feature: "test",
      route: "POST /api/test",
    },
  };
}

test("enters circuit breaker on 429 + X-Budget-Exceeded and drops subsequent events", async () => {
  let requestCount = 0;

  const { server, url } = await createMockServer((req, res, body) => {
    requestCount++;
    res.writeHead(429, {
      "Content-Type": "application/json",
      "X-Budget-Exceeded": "true",
      "X-Budget-Limit": "50",
      "X-Budget-Current": "75.00",
      "Retry-After": "300",
    });
    res.end(JSON.stringify({
      accepted: 0,
      duplicates: 0,
      rejected: 1,
      errors: ["budget exceeded"],
    }));
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test",
      endpoint: url,
      maxRetries: 2,
      budgetBackoffMs: 60_000, // 1 minute for test
    });

    // First call triggers budget exceeded
    const result1 = await client.trackUsage(makeEvent());
    assert.equal(result1.ok, false);
    assert.ok(result1.error.includes("budget exceeded"));

    // Should have only made 1 request (no retries on BudgetExceededError)
    assert.equal(requestCount, 1, "should not retry on budget exceeded");

    // Second call should be silently dropped by circuit breaker (no HTTP request)
    const result2 = await client.trackUsage(makeEvent());
    assert.equal(result2.ok, false);
    assert.ok(result2.error.includes("circuit breaker"));
    assert.equal(requestCount, 1, "circuit breaker should prevent HTTP request");

    // Third call also dropped
    const result3 = await client.trackUsage(makeEvent());
    assert.equal(result3.ok, false);
    assert.equal(requestCount, 1, "still no new requests");
  } finally {
    server.close();
  }
});

test("fires onBudgetExceeded callback once", async () => {
  const { server, url } = await createMockServer((req, res) => {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "X-Budget-Exceeded": "true",
      "X-Budget-Limit": "100",
      "X-Budget-Current": "120.50",
    });
    res.end(JSON.stringify({ accepted: 0, duplicates: 0, rejected: 1, errors: ["budget exceeded"] }));
  });

  try {
    const callbackCalls = [];
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test",
      endpoint: url,
      maxRetries: 0,
      budgetBackoffMs: 60_000,
      onBudgetExceeded: (info) => callbackCalls.push(info),
    });

    await client.trackUsage(makeEvent());
    await client.trackUsage(makeEvent()); // circuit breaker, no HTTP

    assert.equal(callbackCalls.length, 1, "callback should fire exactly once");
    assert.equal(callbackCalls[0].limitUsd, 100);
    assert.equal(callbackCalls[0].currentSpendUsd, 120.5);
    assert.equal(callbackCalls[0].retryAfterMs, 60_000);
  } finally {
    server.close();
  }
});

test("retries (probe) after backoff expires", async () => {
  let requestCount = 0;

  const { server, url } = await createMockServer((req, res) => {
    requestCount++;
    if (requestCount === 1) {
      // First request: budget exceeded
      res.writeHead(429, {
        "Content-Type": "application/json",
        "X-Budget-Exceeded": "true",
        "X-Budget-Limit": "50",
        "X-Budget-Current": "75.00",
      });
      res.end(JSON.stringify({ accepted: 0, duplicates: 0, rejected: 1, errors: ["budget exceeded"] }));
    } else {
      // Subsequent requests: success (budget was increased)
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: 1, duplicates: 0, rejected: 0, errors: [] }));
    }
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test",
      endpoint: url,
      maxRetries: 0,
      budgetBackoffMs: 50, // Very short backoff for test
    });

    // First call triggers circuit breaker
    const result1 = await client.trackUsage(makeEvent());
    assert.equal(result1.ok, false);
    assert.equal(requestCount, 1);

    // Wait for backoff to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Next call should send a probe (backoff expired)
    const result2 = await client.trackUsage(makeEvent());
    assert.equal(result2.ok, true, "probe should succeed");
    assert.equal(requestCount, 2, "should have sent probe request");
  } finally {
    server.close();
  }
});

test("does not enter circuit breaker on regular 429 (no X-Budget-Exceeded header)", async () => {
  let requestCount = 0;

  const { server, url } = await createMockServer((req, res) => {
    requestCount++;
    // Regular rate limit 429, no X-Budget-Exceeded header
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: 0, duplicates: 0, rejected: 1, errors: ["rate limited"] }));
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test",
      endpoint: url,
      maxRetries: 1,
      timeoutMs: 2000,
    });

    const result = await client.trackUsage(makeEvent());
    assert.equal(result.ok, false);
    // Should have retried (1 initial + 1 retry = 2)
    assert.equal(requestCount, 2, "should retry on regular 429");
  } finally {
    server.close();
  }
});
