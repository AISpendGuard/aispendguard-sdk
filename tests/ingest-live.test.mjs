import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sdk = require("../dist/index.js");

const endpoint = process.env.AISPENDGUARD_ENDPOINT || "http://localhost:3000/api/ingest";
const apiKey = process.env.AISPENDGUARD_API_KEY;
const workspaceId = process.env.AISPENDGUARD_WORKSPACE_ID;

if (!apiKey || !workspaceId) {
  test("live ingest test skipped (missing env)", { skip: true }, () => {});
} else {
  test("can send live event to ingest API", async () => {
    const client = new sdk.AISpendGuardClient({
      apiKey,
      endpoint,
      strict: true,
      timeoutMs: 8000,
      maxRetries: 1
    });

    const result = await client.trackUsage({
      eventId: `sdk-live-${Date.now()}`,
      workspaceId,
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 10,
      outputTokens: 2,
      latencyMs: 120,
      timestamp: new Date().toISOString(),
      tags: {
        task_type: "classify",
        feature: "sdk_live_test",
        route: "POST /sdk/live"
      }
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(typeof result.response.accepted, "number");
    assert.equal(typeof result.response.rejected, "number");
    assert.equal(typeof result.response.duplicates, "number");
    assert.equal(result.response.accepted + result.response.duplicates >= 1, true);
  });
}
