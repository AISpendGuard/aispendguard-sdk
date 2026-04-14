import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createMastraExporter } = require("../dist/mastra.js");

// ── Valid config ─────────────────────────────────────────────────────────────

test("valid config returns correct telemetry object", () => {
  const result = createMastraExporter({ apiKey: "asg_test123" });

  assert.equal(result.serviceName, "mastra-app");
  assert.equal(result.enabled, true);
  assert.equal(result.export.type, "otlp");
  assert.equal(result.export.endpoint, "https://www.aispendguard.com/api/ingest/otlp");
  assert.equal(result.export.headers["x-api-key"], "asg_test123");
  assert.ok(result.resource);
  assert.ok(result.resource.attributes);
});

test("default endpoint is www.aispendguard.com/api/ingest/otlp", () => {
  const result = createMastraExporter({ apiKey: "asg_abc" });
  assert.equal(result.export.endpoint, "https://www.aispendguard.com/api/ingest/otlp");
});

test("custom endpoint overrides default", () => {
  const result = createMastraExporter({
    apiKey: "asg_abc",
    endpoint: "https://custom.example.com/otlp",
  });
  assert.equal(result.export.endpoint, "https://custom.example.com/otlp");
});

test("API key in headers", () => {
  const result = createMastraExporter({ apiKey: "asg_mykey" });
  assert.equal(result.export.headers["x-api-key"], "asg_mykey");
});

// ── Missing/invalid API key ─────────────────────────────────────────────────

test("missing API key throws", () => {
  assert.throws(
    () => createMastraExporter({}),
    { message: /apiKey is required/ },
  );
});

test("invalid API key prefix throws", () => {
  assert.throws(
    () => createMastraExporter({ apiKey: "sk_wrong" }),
    { message: /must start with 'asg_'/ },
  );
});

test("empty API key throws", () => {
  assert.throws(
    () => createMastraExporter({ apiKey: "" }),
    { message: /apiKey is required/ },
  );
});

// ── Default tags ─────────────────────────────────────────────────────────────

test("defaultTags mapped to resource attributes with aispendguard.tag prefix", () => {
  const result = createMastraExporter({
    apiKey: "asg_test",
    defaultTags: { task_type: "agent", feature: "support", route: "/api/chat" },
  });

  assert.equal(result.resource.attributes["aispendguard.tag.task_type"], "agent");
  assert.equal(result.resource.attributes["aispendguard.tag.feature"], "support");
  assert.equal(result.resource.attributes["aispendguard.tag.route"], "/api/chat");
});

test("source tag auto-set to mastra when not provided", () => {
  const result = createMastraExporter({ apiKey: "asg_test" });
  assert.equal(result.resource.attributes["aispendguard.tag.source"], "mastra");
});

test("source tag can be overridden via defaultTags", () => {
  const result = createMastraExporter({
    apiKey: "asg_test",
    defaultTags: { source: "custom-app" },
  });
  assert.equal(result.resource.attributes["aispendguard.tag.source"], "custom-app");
});

// ── Service name ─────────────────────────────────────────────────────────────

test("custom service name", () => {
  const result = createMastraExporter({
    apiKey: "asg_test",
    serviceName: "my-agent-app",
  });
  assert.equal(result.serviceName, "my-agent-app");
});

test("default service name is mastra-app", () => {
  const result = createMastraExporter({ apiKey: "asg_test" });
  assert.equal(result.serviceName, "mastra-app");
});

// ── Return type shape ────────────────────────────────────────────────────────

test("return type has exactly expected keys", () => {
  const result = createMastraExporter({ apiKey: "asg_test" });
  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, ["enabled", "export", "resource", "serviceName"]);
});

// ── No prompt content in config ──────────────────────────────────────────────

test("no forbidden keys in returned config", () => {
  const result = createMastraExporter({
    apiKey: "asg_test",
    defaultTags: { task_type: "agent" },
  });
  const serialized = JSON.stringify(result);
  const forbidden = ["gen_ai.prompt", "gen_ai.completion", "prompt", "completion", "messages", "content"];
  for (const key of forbidden) {
    assert.ok(!serialized.includes(`"${key}"`), `Config should not contain forbidden key: ${key}`);
  }
});
