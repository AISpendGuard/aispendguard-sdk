import type { UsageEventInput, UsageTags } from "./types";

/**
 * Anthropic Messages API response.usage shape.
 *
 * Cache tokens (prompt caching feature):
 *   - cache_read_input_tokens    → cache read hits  — billed at 0.1× base input price (very cheap)
 *   - cache_creation_input_tokens → cache writes    — billed at 1.25× base input price (slightly expensive)
 *   Both are already counted in input_tokens; store separately for accurate cost calculation.
 *
 * Extended thinking (claude-3-7-sonnet with thinking: { type: "enabled", budget_tokens: N }):
 *   - Thinking tokens are NOT reported separately in the usage object.
 *   - They are included in output_tokens along with visible text tokens.
 *   - If you need them separately, count content blocks of type "thinking" manually.
 */
type AnthropicUsageLike = {
  input_tokens?: number;
  output_tokens?: number;
  /** Cache read tokens — billed at 0.1× base input price. Included in input_tokens. */
  cache_read_input_tokens?: number;
  /** Cache write tokens — billed at 1.25× base input price. Included in input_tokens. */
  cache_creation_input_tokens?: number;
};

export type AnthropicEventParams = {
  workspaceId: string;
  model: string;
  /**
   * The resolved model name as returned in response.model
   * (e.g. "claude-3-5-sonnet-20241022" when you passed "claude-3-5-sonnet-latest").
   * Pass message.model here for accurate model version tracking.
   */
  resolvedModel?: string;
  usage: AnthropicUsageLike | null | undefined;
  latencyMs: number;
  timestamp?: string | Date;
  costUsd?: number;
  tags: UsageTags;
  eventId?: string;
};

export function createAnthropicUsageEvent(params: AnthropicEventParams): UsageEventInput {
  const usage = params.usage;
  const cacheRead = usage?.cache_read_input_tokens;
  const cacheWrite = usage?.cache_creation_input_tokens;
  return {
    eventId: params.eventId,
    workspaceId: params.workspaceId,
    provider: "anthropic",
    model: params.model,
    resolvedModel: params.resolvedModel,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    ...(typeof cacheRead === "number" ? { inputTokensCached: cacheRead } : {}),
    ...(typeof cacheWrite === "number" ? { inputTokensCacheWrite: cacheWrite } : {}),
    latencyMs: params.latencyMs,
    costUsd: params.costUsd,
    timestamp: params.timestamp ?? new Date(),
    tags: params.tags
  };
}
