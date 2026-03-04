import type { IngestEventPayload, UsageEventInput } from "./types";

const REQUIRED_TAGS = ["task_type", "feature", "route"] as const;
const ALLOWED_TAGS = new Set([
  ...REQUIRED_TAGS,
  "customer_plan",
  "customer_id",
  "provider",
  "model",
  "environment",
  "agent_name"
]);

const FORBIDDEN_KEYS = [
  "prompt",
  "prompts",
  "input",
  "inputs",
  "completion",
  "completions",
  "output",
  "outputs",
  "content",
  "message",
  "messages",
  "attachment",
  "attachments"
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsForbiddenKeys(obj: Record<string, unknown>): string | null {
  const lower = Object.keys(obj).map((k) => k.toLowerCase());
  const found = FORBIDDEN_KEYS.find((k) => lower.includes(k));
  return found ?? null;
}

function assertNonEmptyString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertNonNegative(value: unknown, field: string, integerOnly = true) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  if (integerOnly && !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
}

function normalizeTimestamp(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("timestamp must be a valid ISO-8601 datetime");
  }
  return d.toISOString();
}

function normalizeTags(tags: unknown): Record<string, string> {
  if (!isObject(tags)) {
    throw new Error("tags must be an object");
  }

  const forbidden = containsForbiddenKeys(tags);
  if (forbidden) {
    throw new Error(`tags contains forbidden key: ${forbidden}`);
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!ALLOWED_TAGS.has(key)) {
      throw new Error(`tags.${key} is not supported`);
    }
    assertNonEmptyString(value, `tags.${key}`);
    normalized[key] = String(value).trim();
  }

  for (const key of REQUIRED_TAGS) {
    if (!normalized[key]) {
      throw new Error(`tags.${key} is required`);
    }
  }

  return normalized;
}

export function normalizeEvent(
  event: UsageEventInput,
  fallbackWorkspaceId?: string
): IngestEventPayload {
  if (!isObject(event as unknown as Record<string, unknown>)) {
    throw new Error("event must be an object");
  }

  const forbidden = containsForbiddenKeys(event as unknown as Record<string, unknown>);
  if (forbidden) {
    throw new Error(`event contains forbidden field: ${forbidden}`);
  }

  const workspaceId = event.workspaceId || fallbackWorkspaceId;
  assertNonEmptyString(workspaceId, "workspaceId");
  assertNonEmptyString(event.provider, "provider");
  assertNonEmptyString(event.model, "model");
  assertNonNegative(event.inputTokens, "inputTokens", true);
  assertNonNegative(event.outputTokens, "outputTokens", true);
  assertNonNegative(event.latencyMs, "latencyMs", true);

  if (event.costUsd !== undefined) {
    assertNonNegative(event.costUsd, "costUsd", false);
  }

  if (event.eventId !== undefined) {
    assertNonEmptyString(event.eventId, "eventId");
  }

  return {
    ...(event.eventId ? { event_id: event.eventId.trim() } : {}),
    workspace_id: workspaceId!,
    provider: event.provider.trim().toLowerCase(),
    model: event.model.trim(),
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    latency_ms: event.latencyMs,
    ...(event.costUsd !== undefined ? { cost_usd: event.costUsd } : {}),
    timestamp: normalizeTimestamp(event.timestamp),
    tags: normalizeTags(event.tags)
  };
}
