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
const CUSTOM_TAG_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_TAGS_PER_EVENT = 24;
const MAX_TAG_VALUE_LENGTH = 120;
const MAX_TAG_ARRAY_ITEMS = 16;

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

function normalizeTags(tags: unknown): Record<string, string | string[]> {
  if (!isObject(tags)) {
    throw new Error("tags must be an object");
  }

  const forbidden = containsForbiddenKeys(tags);
  if (forbidden) {
    throw new Error(`tags contains forbidden key: ${forbidden}`);
  }

  const normalized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(tags)) {
    const isKnown = ALLOWED_TAGS.has(key);
    const isCustom = CUSTOM_TAG_KEY_PATTERN.test(key) && !FORBIDDEN_KEYS.includes(key as never);
    if (!isKnown && !isCustom) {
      throw new Error(
        `tags.${key} is not supported (use known tags or lowercase custom keys like team, project_code)`
      );
    }
    if (typeof value === "string") {
      assertNonEmptyString(value, `tags.${key}`);
      const normalizedValue = value.trim();
      if (normalizedValue.length > MAX_TAG_VALUE_LENGTH) {
        throw new Error(`tags.${key} exceeds max length ${MAX_TAG_VALUE_LENGTH}`);
      }
      normalized[key] = normalizedValue;
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        throw new Error(`tags.${key} array must not be empty`);
      }
      if (value.length > MAX_TAG_ARRAY_ITEMS) {
        throw new Error(`tags.${key} has too many values (max ${MAX_TAG_ARRAY_ITEMS})`);
      }

      const normalizedArray = value.map((item, idx) => {
        if (typeof item !== "string" || item.trim().length === 0) {
          throw new Error(`tags.${key}[${idx}] must be a non-empty string`);
        }
        const normalizedItem = item.trim();
        if (normalizedItem.length > MAX_TAG_VALUE_LENGTH) {
          throw new Error(`tags.${key}[${idx}] exceeds max length ${MAX_TAG_VALUE_LENGTH}`);
        }
        return normalizedItem;
      });

      normalized[key] = normalizedArray;
      continue;
    }

    throw new Error(`tags.${key} must be a string or string[]`);
  }

  if (Object.keys(normalized).length > MAX_TAGS_PER_EVENT) {
    throw new Error(`tags has too many keys (max ${MAX_TAGS_PER_EVENT})`);
  }

  for (const key of REQUIRED_TAGS) {
    const requiredValue = normalized[key];
    if (typeof requiredValue !== "string" || requiredValue.length === 0) {
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

  if (event.resolvedModel !== undefined) {
    assertNonEmptyString(event.resolvedModel, "resolvedModel");
  }

  if (event.inputTokensCached !== undefined) {
    assertNonNegative(event.inputTokensCached, "inputTokensCached", true);
  }

  if (event.inputTokensCacheWrite !== undefined) {
    assertNonNegative(event.inputTokensCacheWrite, "inputTokensCacheWrite", true);
  }

  if (event.thinkingTokens !== undefined) {
    assertNonNegative(event.thinkingTokens, "thinkingTokens", true);
  }

  return {
    ...(event.eventId ? { event_id: event.eventId.trim() } : {}),
    workspace_id: workspaceId!,
    provider: event.provider.trim().toLowerCase(),
    model: event.model.trim(),
    ...(event.resolvedModel ? { resolved_model: event.resolvedModel.trim() } : {}),
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    ...(event.inputTokensCached !== undefined ? { input_tokens_cached: event.inputTokensCached } : {}),
    ...(event.inputTokensCacheWrite !== undefined ? { input_tokens_cache_write: event.inputTokensCacheWrite } : {}),
    ...(event.thinkingTokens !== undefined ? { thinking_tokens: event.thinkingTokens } : {}),
    latency_ms: event.latencyMs,
    ...(event.costUsd !== undefined ? { cost_usd: event.costUsd } : {}),
    timestamp: normalizeTimestamp(event.timestamp),
    tags: normalizeTags(event.tags)
  };
}
