import type { UsageEventInput, UsageTags } from "./types";

/**
 * Google Gemini generateContent / generateContentStream response.usageMetadata shape.
 *
 *   promptTokenCount      → input tokens
 *   candidatesTokenCount  → output tokens (visible text)
 *   cachedContentTokenCount → context cache hits — billed at reduced price (~0.25×)
 *   thoughtsTokenCount    → Gemini 2.5 thinking tokens — billed separately (in addition to output)
 *   totalTokenCount       → sum of all above
 *
 * Notes:
 *   - cachedContentTokenCount is only present when you use the Context Caching API.
 *   - thoughtsTokenCount is only present for Gemini 2.5 Flash/Pro with thinking enabled.
 *   - candidatesTokenCount does NOT include thoughtsTokenCount (unlike Anthropic).
 *     Gemini bills thinking tokens on top of output tokens.
 */
type GeminiUsageLike = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

export type GeminiEventParams = {
  workspaceId: string;
  model: string;
  /**
   * The resolved model version as returned in response.modelVersion
   * (e.g. "gemini-2.0-flash-001" when you passed "gemini-2.0-flash").
   * Pass response.modelVersion here for accurate model version tracking.
   */
  resolvedModel?: string;
  usage: GeminiUsageLike | null | undefined;
  latencyMs: number;
  timestamp?: string | Date;
  costUsd?: number;
  tags: UsageTags;
  eventId?: string;
};

export function createGeminiUsageEvent(params: GeminiEventParams): UsageEventInput {
  const usage = params.usage;
  const cached = usage?.cachedContentTokenCount;
  const thinking = usage?.thoughtsTokenCount;
  return {
    eventId: params.eventId,
    workspaceId: params.workspaceId,
    provider: "google",
    model: params.model,
    resolvedModel: params.resolvedModel,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    ...(typeof cached === "number" ? { inputTokensCached: cached } : {}),
    ...(typeof thinking === "number" ? { thinkingTokens: thinking } : {}),
    latencyMs: params.latencyMs,
    costUsd: params.costUsd,
    timestamp: params.timestamp ?? new Date(),
    tags: params.tags
  };
}
