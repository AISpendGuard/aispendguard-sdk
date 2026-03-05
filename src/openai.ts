import type { UsageEventInput, UsageTags } from "./types";

/**
 * Covers both OpenAI Chat Completions and Responses API response.usage shapes.
 *
 * Chat Completions: prompt_tokens / completion_tokens
 *   - prompt_tokens_details.cached_tokens        → cache read (0.5× base input price)
 *   - completion_tokens_details.reasoning_tokens → o1/o3 thinking (billed as output)
 *
 * Responses API: input_tokens / output_tokens
 *   - input_tokens_details.cached_tokens         → cache read (0.5× base input price)
 *   - output_tokens_details.reasoning_tokens     → o1/o3 thinking (billed as output)
 */
type OpenAIUsageLike = {
  // Responses API field names
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
  // Chat Completions field names
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

export type OpenAIEventParams = {
  workspaceId: string;
  model: string;
  /**
   * The resolved model name as returned in response.model (e.g. "gpt-4o-mini-2024-07-18").
   * Pass response.model here for accurate model version tracking.
   */
  resolvedModel?: string;
  usage: OpenAIUsageLike | null | undefined;
  latencyMs: number;
  timestamp?: string | Date;
  costUsd?: number;
  tags: UsageTags;
  eventId?: string;
};

function getInputTokens(usage: OpenAIUsageLike | null | undefined): number {
  if (!usage) return 0;
  if (typeof usage.input_tokens === "number") return usage.input_tokens;
  if (typeof usage.prompt_tokens === "number") return usage.prompt_tokens;
  return 0;
}

function getOutputTokens(usage: OpenAIUsageLike | null | undefined): number {
  if (!usage) return 0;
  if (typeof usage.output_tokens === "number") return usage.output_tokens;
  if (typeof usage.completion_tokens === "number") return usage.completion_tokens;
  return 0;
}

/** Cache read tokens — billed at 0.5× base input price. Already counted in inputTokens. */
function getCachedTokens(usage: OpenAIUsageLike | null | undefined): number | undefined {
  if (!usage) return undefined;
  const v =
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens;
  return typeof v === "number" ? v : undefined;
}

/**
 * Reasoning tokens for o1/o3 models — billed as output tokens.
 * Already counted in outputTokens; stored separately for cost spike detection.
 */
function getReasoningTokens(usage: OpenAIUsageLike | null | undefined): number | undefined {
  if (!usage) return undefined;
  const v =
    usage.output_tokens_details?.reasoning_tokens ??
    usage.completion_tokens_details?.reasoning_tokens;
  return typeof v === "number" ? v : undefined;
}

export function createOpenAIUsageEvent(params: OpenAIEventParams): UsageEventInput {
  const cached = getCachedTokens(params.usage);
  const thinking = getReasoningTokens(params.usage);
  return {
    eventId: params.eventId,
    workspaceId: params.workspaceId,
    provider: "openai",
    model: params.model,
    resolvedModel: params.resolvedModel,
    inputTokens: getInputTokens(params.usage),
    outputTokens: getOutputTokens(params.usage),
    ...(typeof cached === "number" ? { inputTokensCached: cached } : {}),
    ...(typeof thinking === "number" ? { thinkingTokens: thinking } : {}),
    latencyMs: params.latencyMs,
    costUsd: params.costUsd,
    timestamp: params.timestamp ?? new Date(),
    tags: params.tags
  };
}
