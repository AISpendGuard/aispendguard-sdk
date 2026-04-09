/**
 * Tests for SDK checkBudget() pre-request budget check method.
 *
 * Scenarios:
 * 1. checkBudget() with no options — returns budget status
 * 2. checkBudget({ estimatedCost }) — includes wouldExceed in result
 * 3. checkBudget() with invalid estimatedCost — throws error
 * 4. checkBudget() when server returns { budget: null } — returns hasBudget: false
 * 5. checkBudget() network error — throws error
 * 6. checkBudget() timeout — throws timeout error
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);
const sdk = require("../dist/index.js");

/**
 * Create a simple HTTP server for mocking the budget endpoint.
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

test("checkBudget() with no options returns budget status", async () => {
  const { server, url } = await createMockServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.ok(req.url.startsWith("/api/v1/budget"));
    assert.equal(req.headers["x-api-key"], "asg_test_key");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      budget: {
        monthlyLimitUsd: 100,
        currentSpendUsd: 42.50,
        percentUsed: 42.5,
        enforceLimit: true,
        exceeded: false,
        enforcementRules: [],
      },
    }));
  });

  try {
    // endpoint must end in /api/ingest so budgetEndpoint derives /api/v1/budget
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test_key",
      endpoint: `${url}/api/ingest`,
      timeoutMs: 5000,
    });

    const result = await client.checkBudget();

    assert.equal(result.hasBudget, true);
    assert.equal(result.monthlyLimitUsd, 100);
    assert.equal(result.currentSpendUsd, 42.50);
    assert.equal(result.percentUsed, 42.5);
    assert.equal(result.enforceLimit, true);
    assert.equal(result.exceeded, false);
  } finally {
    server.close();
  }
});

test("checkBudget({ estimatedCost }) includes wouldExceed and triggeredRule", async () => {
  const { server, url } = await createMockServer((req, res) => {
    // Verify estimatedCost is passed as query param
    const parsedUrl = new URL(req.url, `http://127.0.0.1`);
    assert.equal(parsedUrl.searchParams.get("estimatedCost"), "25.5");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      budget: {
        monthlyLimitUsd: 100,
        currentSpendUsd: 80,
        percentUsed: 80,
        enforceLimit: true,
        exceeded: false,
        wouldExceed: true,
        triggeredRule: {
          thresholdPercent: 90,
          action: "warn",
        },
      },
    }));
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test_key",
      endpoint: `${url}/api/ingest`,
      timeoutMs: 5000,
    });

    const result = await client.checkBudget({ estimatedCost: 25.50 });

    assert.equal(result.hasBudget, true);
    assert.equal(result.wouldExceed, true);
    assert.deepEqual(result.triggeredRule, { thresholdPercent: 90, action: "warn" });
    assert.equal(result.currentSpendUsd, 80);
  } finally {
    server.close();
  }
});

test("checkBudget() with invalid estimatedCost throws error", async () => {
  const client = new sdk.AISpendGuardClient({
    apiKey: "asg_test_key",
    endpoint: "http://127.0.0.1:1/api/ingest",
    timeoutMs: 5000,
  });

  // Negative cost
  await assert.rejects(
    () => client.checkBudget({ estimatedCost: -5 }),
    { message: "estimatedCost must be a finite non-negative number" }
  );

  // NaN
  await assert.rejects(
    () => client.checkBudget({ estimatedCost: NaN }),
    { message: "estimatedCost must be a finite non-negative number" }
  );

  // Infinity
  await assert.rejects(
    () => client.checkBudget({ estimatedCost: Infinity }),
    { message: "estimatedCost must be a finite non-negative number" }
  );
});

test("checkBudget() when server returns { budget: null } returns hasBudget: false", async () => {
  const { server, url } = await createMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ budget: null }));
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test_key",
      endpoint: `${url}/api/ingest`,
      timeoutMs: 5000,
    });

    const result = await client.checkBudget();

    assert.equal(result.hasBudget, false);
    assert.equal(result.monthlyLimitUsd, null);
    assert.equal(result.currentSpendUsd, null);
    assert.equal(result.percentUsed, null);
    assert.equal(result.enforceLimit, false);
    assert.equal(result.exceeded, false);
  } finally {
    server.close();
  }
});

test("checkBudget() network error throws descriptive error", async () => {
  const client = new sdk.AISpendGuardClient({
    apiKey: "asg_test_key",
    // Port 1 should be unreachable
    endpoint: "http://127.0.0.1:1/api/ingest",
    timeoutMs: 2000,
  });

  await assert.rejects(
    () => client.checkBudget(),
    (err) => {
      assert.ok(err instanceof Error);
      // Should throw either a connection error or timeout
      return true;
    }
  );
});

test("checkBudget() timeout throws timeout error", async () => {
  const { server, url } = await createMockServer((req, res) => {
    // Never respond — let the timeout fire
  });

  try {
    const client = new sdk.AISpendGuardClient({
      apiKey: "asg_test_key",
      endpoint: `${url}/api/ingest`,
      timeoutMs: 100, // Very short timeout
    });

    await assert.rejects(
      () => client.checkBudget(),
      { message: "budget check timed out after 100ms" }
    );
  } finally {
    server.close();
  }
});
