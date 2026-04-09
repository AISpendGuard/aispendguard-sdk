/**
 * Tests for SDK enforcement body parsing in trackUsage() responses.
 *
 * When the ingest endpoint returns enforcement signals in the response body
 * (enforcement.action === "block"), the SDK should activate the circuit breaker
 * and fire the onBudgetExceeded callback.
 *
 * Scenarios:
 * 1. trackUsage() with enforcement.action: "block" — circuit breaker activates
 * 2. trackUsage() with enforcement.action: "warn" — no circuit breaker
 * 3. onBudgetExceeded callback fires exactly once on block enforcement
 * 4. Circuit breaker backoff uses budgetBackoffMs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);
const sdk = require("../dist/index.js");

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

test("trackUsage() with enforcement.action block activates circuit breaker", async () => {
  let requestCount = 0;

  const { server, url } = await createMockServer((req, res) => {
    requestCount++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      enforcement: {
        action: "block",
        reason: "monthly budget exceeded",
        budget_limit: 50,
        current_spend: 55,
        current_percent: 110,
      },
    }));
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test",
      endpoint: url,
      maxRetries: 0,
      budgetBackoffMs: 60_000,
    });

    // First call succeeds but activates circuit breaker from body enforcement
    const result1 = await client.trackUsage(makeEvent());
    assert.equal(result1.ok, true, "first call should succeed (events accepted)");
    assert.equal(result1.response.accepted, 1);
    assert.equal(result1.response.enforcement.action, "block");
    assert.equal(requestCount, 1);

    // Second call should be dropped by circuit breaker (no HTTP request)
    const result2 = await client.trackUsage(makeEvent());
    assert.equal(result2.ok, false, "second call should be blocked by circuit breaker");
    assert.ok(result2.error.includes("circuit breaker"), "error should mention circuit breaker");
    assert.equal(requestCount, 1, "no new HTTP request should be made");
  } finally {
    server.close();
  }
});

test("trackUsage() with enforcement.action warn does NOT activate circuit breaker", async () => {
  let requestCount = 0;

  const { server, url } = await createMockServer((req, res) => {
    requestCount++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      enforcement: {
        action: "warn",
        reason: "approaching budget limit",
        budget_limit: 100,
        current_spend: 75,
        current_percent: 75,
      },
    }));
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test",
      endpoint: url,
      maxRetries: 0,
      budgetBackoffMs: 60_000,
    });

    // First call
    const result1 = await client.trackUsage(makeEvent());
    assert.equal(result1.ok, true);
    assert.equal(requestCount, 1);

    // Second call should also succeed (no circuit breaker for warn)
    const result2 = await client.trackUsage(makeEvent());
    assert.equal(result2.ok, true);
    assert.equal(requestCount, 2, "warn action should not block subsequent calls");
  } finally {
    server.close();
  }
});

test("onBudgetExceeded callback fires exactly once on block enforcement from body", async () => {
  const { server, url } = await createMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      enforcement: {
        action: "block",
        reason: "budget exceeded",
        budget_limit: 200,
        current_spend: 215.75,
        current_percent: 107.88,
      },
    }));
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

    // First call triggers block enforcement
    await client.trackUsage(makeEvent());
    // Second call hits circuit breaker (no HTTP)
    await client.trackUsage(makeEvent());
    // Third call also circuit breaker
    await client.trackUsage(makeEvent());

    assert.equal(callbackCalls.length, 1, "onBudgetExceeded should fire exactly once");
    assert.equal(callbackCalls[0].limitUsd, 200);
    assert.equal(callbackCalls[0].currentSpendUsd, 215.75);
    assert.equal(callbackCalls[0].retryAfterMs, 60_000);
  } finally {
    server.close();
  }
});

test("circuit breaker respects budgetBackoffMs and recovers after expiry", async () => {
  let requestCount = 0;

  const { server, url } = await createMockServer((req, res) => {
    requestCount++;
    if (requestCount === 1) {
      // First: block enforcement
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        enforcement: {
          action: "block",
          reason: "budget exceeded",
          budget_limit: 50,
          current_spend: 60,
        },
      }));
    } else {
      // After recovery: normal response, no enforcement
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        accepted: 1,
        duplicates: 0,
        rejected: 0,
      }));
    }
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test",
      endpoint: url,
      maxRetries: 0,
      budgetBackoffMs: 50, // Very short backoff for test
    });

    // First call triggers circuit breaker via body enforcement
    const result1 = await client.trackUsage(makeEvent());
    assert.equal(result1.ok, true);
    assert.equal(requestCount, 1);

    // Immediately: should be blocked
    const result2 = await client.trackUsage(makeEvent());
    assert.equal(result2.ok, false);
    assert.equal(requestCount, 1, "blocked by circuit breaker");

    // Wait for backoff to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should send probe now
    const result3 = await client.trackUsage(makeEvent());
    assert.equal(result3.ok, true, "probe should succeed after backoff");
    assert.equal(requestCount, 2, "should have sent probe request");
  } finally {
    server.close();
  }
});
