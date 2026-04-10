import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sdk = require("../dist/index.js");

// Mock client that captures sent events
function setupMockClient() {
  const captured = [];
  sdk.init({
    apiKey: "asg_test_mock",
    endpoint: "http://localhost:0/api/ingest",
    maxRetries: 0,
  });

  // Monkey-patch the client's trackUsage to capture events instead of sending
  const client = sdk.getClient();
  const originalTrackUsage = client.trackUsage.bind(client);
  client.trackUsage = async (events) => {
    const list = Array.isArray(events) ? events : [events];
    captured.push(...list);
    return { ok: true, response: { accepted: list.length, duplicates: 0, rejected: 0 } };
  };

  return { captured, restore: () => { client.trackUsage = originalTrackUsage; } };
}

function makeEvent(overrides) {
  return {
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 1000,
    outputTokens: 500,
    latencyMs: 100,
    timestamp: new Date().toISOString(),
    tags: { task_type: "chat", feature: "test-feature", route: "POST /api/test" },
    ...overrides,
  };
}

test("constructor rejects maxBudget <= 0", () => {
  assert.throws(
    () => new sdk.SessionBudget({ maxBudget: 0 }),
    /maxBudget must be > 0/
  );
  assert.throws(
    () => new sdk.SessionBudget({ maxBudget: -5 }),
    /maxBudget must be > 0/
  );
});

test("constructor rejects softLimitPercent outside 1-99", () => {
  assert.throws(
    () => new sdk.SessionBudget({ maxBudget: 10, softLimitPercent: 0 }),
    /softLimitPercent must be between 1 and 99/
  );
  assert.throws(
    () => new sdk.SessionBudget({ maxBudget: 10, softLimitPercent: 100 }),
    /softLimitPercent must be between 1 and 99/
  );
});

test("constructor accepts valid config", () => {
  const budget = new sdk.SessionBudget({ maxBudget: 5.00 });
  assert.equal(budget.currentSpend, 0);
  assert.equal(budget.isExceeded, false);
  assert.equal(budget.totalCalls, 0);
});

test("soft limit fires callback once at 90%", async () => {
  const { captured, restore } = setupMockClient();
  const softLimitCalls = [];

  const budget = new sdk.SessionBudget({
    maxBudget: 1.00,
    softLimitPercent: 90,
    onSoftLimit: (info) => softLimitCalls.push(info),
  });

  // gpt-4o: 1000 input + 500 output ~ $0.0075 per call
  // Need ~120 calls to reach $0.90 (90% of $1.00)
  for (let i = 0; i < 125; i++) {
    const result = await budget.trackUsage(makeEvent({}));
    if (!result.ok) break;
  }

  assert.ok(softLimitCalls.length === 1, "soft limit should fire exactly once");
  assert.equal(softLimitCalls[0].action, "soft_limit");
  assert.ok(softLimitCalls[0].currentSpendUsd >= 0.90);

  // Verify enforcement event was sent
  const enforcementEvents = captured.filter(
    (e) => e.provider === "aispendguard" && e.model === "session-budget"
  );
  assert.ok(enforcementEvents.length >= 1, "at least one enforcement event should be sent");

  restore();
});

test("hard limit rejects calls when budget exceeded", async () => {
  const { captured, restore } = setupMockClient();
  const hardLimitCalls = [];

  const budget = new sdk.SessionBudget({
    maxBudget: 0.05,
    onHardLimit: (info) => hardLimitCalls.push(info),
  });

  let okCount = 0;
  let blockedCount = 0;

  for (let i = 0; i < 20; i++) {
    const result = await budget.trackUsage(makeEvent({}));
    if (result.ok) okCount++;
    else blockedCount++;
  }

  assert.ok(okCount > 0, "some calls should succeed before budget");
  assert.ok(blockedCount > 0, "some calls should be blocked");
  assert.ok(hardLimitCalls.length === 1, "hard limit callback fires exactly once");
  assert.equal(hardLimitCalls[0].action, "hard_limit");

  restore();
});

test("hard limit returns session_budget_exceeded error", async () => {
  const { restore } = setupMockClient();

  const budget = new sdk.SessionBudget({ maxBudget: 0.001 });

  // First call should succeed (~$0.0075 > $0.001 so it should be blocked immediately)
  // Actually $0.0075 > $0.001, so first call should be blocked
  const result = await budget.trackUsage(makeEvent({}));
  assert.equal(result.ok, false);
  assert.equal(result.error, "session_budget_exceeded");

  restore();
});

test("loop detection detects rapid calls", async () => {
  const { restore } = setupMockClient();
  const loopCalls = [];

  const budget = new sdk.SessionBudget({
    maxBudget: 100, // high budget so we don't hit budget limit
    loopDetection: { maxCalls: 5, windowMs: 60_000 },
    onLoopDetected: (info) => loopCalls.push(info),
  });

  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push(await budget.trackUsage(makeEvent({})));
  }

  // First 4 calls succeed (callCount 1-4), 5th call triggers loop detection (callCount 5)
  const okResults = results.filter((r) => r.ok);
  const blockedResults = results.filter((r) => !r.ok && r.error === "loop_detected");

  assert.ok(okResults.length === 4, `expected 4 ok results, got ${okResults.length}`);
  assert.ok(blockedResults.length > 0, "loop detection should block calls");
  assert.ok(loopCalls.length >= 1, "loop callback should fire");
  assert.equal(loopCalls[0].action, "loop_detected");

  restore();
});

test("unknown model logs warning and uses $0 cost", async () => {
  const { restore } = setupMockClient();
  const warnings = [];

  const budget = new sdk.SessionBudget({
    maxBudget: 1.00,
    logger: { warn: (msg) => warnings.push(msg) },
  });

  const result = await budget.trackUsage(makeEvent({
    provider: "unknown",
    model: "nonexistent-model",
  }));

  assert.ok(result.ok, "unknown model should not block the call");
  assert.ok(warnings.length > 0, "should log a warning");
  assert.ok(warnings[0].includes("unknown model"), "warning should mention unknown model");
  assert.equal(budget.currentSpend, 0);

  restore();
});

test("costUsd override is used for budget tracking", async () => {
  const { restore } = setupMockClient();

  const budget = new sdk.SessionBudget({ maxBudget: 1.00 });

  await budget.trackUsage(makeEvent({ costUsd: 0.50 }));
  assert.equal(budget.currentSpend, 0.50);

  await budget.trackUsage(makeEvent({ costUsd: 0.40 }));
  assert.equal(budget.currentSpend, 0.90);

  restore();
});

test("reset clears cumulative spend and call count", async () => {
  const { restore } = setupMockClient();

  const budget = new sdk.SessionBudget({ maxBudget: 10.00 });

  await budget.trackUsage(makeEvent({ costUsd: 5.00 }));
  assert.equal(budget.currentSpend, 5.00);
  assert.equal(budget.totalCalls, 1);

  budget.reset();
  assert.equal(budget.currentSpend, 0);
  assert.equal(budget.totalCalls, 0);
  assert.equal(budget.isExceeded, false);

  restore();
});

test("concurrent calls correctly serialize budget checks", async () => {
  const { restore } = setupMockClient();

  const budget = new sdk.SessionBudget({ maxBudget: 0.05 });

  // Fire 10 calls concurrently — each ~$0.0075, so ~6-7 should succeed
  const promises = Array.from({ length: 10 }, () =>
    budget.trackUsage(makeEvent({}))
  );
  const results = await Promise.all(promises);

  const okCount = results.filter((r) => r.ok).length;
  const blockedCount = results.filter((r) => !r.ok).length;

  assert.ok(okCount >= 1, "at least one call should succeed");
  assert.ok(blockedCount >= 1, "at least one call should be blocked");
  assert.ok(budget.currentSpend <= 0.05 + 0.01, "spend should not wildly exceed budget");

  restore();
});

test("enforcement event has correct format", async () => {
  const { captured, restore } = setupMockClient();

  const budget = new sdk.SessionBudget({
    maxBudget: 0.001, // very low — first call triggers hard limit
    onHardLimit: () => {},
  });

  await budget.trackUsage(makeEvent({ traceId: "trace-abc-123" }));

  // Wait a tick for fire-and-forget enforcement event
  await new Promise((resolve) => setTimeout(resolve, 50));

  const enforcement = captured.filter(
    (e) => e.provider === "aispendguard" && e.model === "session-budget"
  );

  assert.ok(enforcement.length >= 1, "enforcement event should be sent");
  const ev = enforcement[0];
  assert.equal(ev.provider, "aispendguard");
  assert.equal(ev.model, "session-budget");
  assert.equal(ev.inputTokens, 0);
  assert.equal(ev.outputTokens, 0);
  assert.equal(ev.latencyMs, 0);
  assert.equal(ev.costUsd, 0);
  assert.equal(ev.tags.task_type, "budget_enforcement");
  assert.equal(ev.tags.enforcement_action, "hard_limit");
  assert.ok(ev.tags.session_budget_usd);
  assert.ok(ev.tags.session_spend_usd);
  assert.ok(ev.tags.session_call_count);
  assert.equal(ev.tags.feature, "test-feature");
  assert.equal(ev.tags.route, "POST /api/test");
  assert.equal(ev.traceId, "trace-abc-123");

  restore();
});

test("isExceeded reflects budget state", async () => {
  const { restore } = setupMockClient();

  const budget = new sdk.SessionBudget({ maxBudget: 1.00 });
  assert.equal(budget.isExceeded, false);

  await budget.trackUsage(makeEvent({ costUsd: 1.00 }));
  assert.equal(budget.isExceeded, true);

  restore();
});

// ── sessionId auto-tagging tests ────────────────────────────────────────

test("sessionId auto-tags events with session_id", async () => {
  const { captured, restore } = setupMockClient();

  const budget = new sdk.SessionBudget({
    maxBudget: 10.00,
    sessionId: "sess_test123",
  });

  await budget.trackUsage(makeEvent({}));

  // Filter out enforcement events
  const userEvents = captured.filter((e) => e.provider !== "aispendguard");
  assert.ok(userEvents.length >= 1, "should have at least one user event");
  assert.equal(userEvents[0].tags.session_id, "sess_test123");

  restore();
});

test("sessionId config overrides event-level session_id tag", async () => {
  const { captured, restore } = setupMockClient();

  const budget = new sdk.SessionBudget({
    maxBudget: 10.00,
    sessionId: "config_set",
  });

  await budget.trackUsage(makeEvent({
    tags: { task_type: "chat", feature: "test", route: "POST /test", session_id: "user_set" },
  }));

  const userEvents = captured.filter((e) => e.provider !== "aispendguard");
  assert.equal(userEvents[0].tags.session_id, "config_set", "config sessionId should win over event tag");

  restore();
});

test("no sessionId does not inject session_id tag", async () => {
  const { captured, restore } = setupMockClient();

  const budget = new sdk.SessionBudget({ maxBudget: 10.00 });

  await budget.trackUsage(makeEvent({}));

  const userEvents = captured.filter((e) => e.provider !== "aispendguard");
  assert.equal(userEvents[0].tags.session_id, undefined, "should not have session_id tag");

  restore();
});

test("createSession() factory generates session with auto ID", () => {
  setupMockClient();

  const session = sdk.createSession({ maxBudget: 5.00 });
  assert.ok(session instanceof sdk.SessionBudget, "should return a SessionBudget instance");

  // Cannot directly access private sessionId, but we can verify via trackUsage
  restore_after_createSession: {
    break restore_after_createSession;
  }
});

test("createSession() auto-tags events with generated sess_ prefix", async () => {
  const { captured, restore } = setupMockClient();

  const session = sdk.createSession({ maxBudget: 5.00 });
  await session.trackUsage(makeEvent({}));

  const userEvents = captured.filter((e) => e.provider !== "aispendguard");
  assert.ok(userEvents.length >= 1);
  assert.ok(
    typeof userEvents[0].tags.session_id === "string" && userEvents[0].tags.session_id.startsWith("sess_"),
    `session_id should start with sess_, got: ${userEvents[0].tags.session_id}`
  );
  assert.equal(userEvents[0].tags.session_id.length, 17, "sess_ (5) + 12 hex chars = 17");

  restore();
});

test("createSession() with explicit sessionId uses it", async () => {
  const { captured, restore } = setupMockClient();

  const session = sdk.createSession({ maxBudget: 5.00, sessionId: "my-run" });
  await session.trackUsage(makeEvent({}));

  const userEvents = captured.filter((e) => e.provider !== "aispendguard");
  assert.equal(userEvents[0].tags.session_id, "my-run");

  restore();
});

test("enforcement events include session_id when sessionId configured", async () => {
  const { captured, restore } = setupMockClient();

  const budget = new sdk.SessionBudget({
    maxBudget: 0.001,
    sessionId: "sess_enforce_test",
    onHardLimit: () => {},
  });

  await budget.trackUsage(makeEvent({}));

  // Wait for fire-and-forget enforcement event
  await new Promise((resolve) => setTimeout(resolve, 50));

  const enforcement = captured.filter(
    (e) => e.provider === "aispendguard" && e.model === "session-budget"
  );
  assert.ok(enforcement.length >= 1, "enforcement event should be sent");
  assert.equal(enforcement[0].tags.session_id, "sess_enforce_test");

  restore();
});
