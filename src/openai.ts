import type { UsageEventInput, UsageTags } from "./types";

type OpenAIUsageLike = {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
};

export type OpenAIEventParams = {
  workspaceId: string;
  model: string;
  usage: OpenAIUsageLike | null | undefined;
  latencyMs: number;
  timestamp?: string | Date;
  costUsd?: number;
  tags: UsageTags;
  eventId?: string;
};

function getInputTokens(usage: OpenAIUsageLike | null | undefined) {
  if (!usage) return 0;
  if (typeof usage.input_tokens === "number") return usage.input_tokens;
  if (typeof usage.prompt_tokens === "number") return usage.prompt_tokens;
  return 0;
}

function getOutputTokens(usage: OpenAIUsageLike | null | undefined) {
  if (!usage) return 0;
  if (typeof usage.output_tokens === "number") return usage.output_tokens;
  if (typeof usage.completion_tokens === "number") return usage.completion_tokens;
  return 0;
}

export function createOpenAIUsageEvent(params: OpenAIEventParams): UsageEventInput {
  return {
    eventId: params.eventId,
    workspaceId: params.workspaceId,
    provider: "openai",
    model: params.model,
    inputTokens: getInputTokens(params.usage),
    outputTokens: getOutputTokens(params.usage),
    latencyMs: params.latencyMs,
    costUsd: params.costUsd,
    timestamp: params.timestamp ?? new Date(),
    tags: params.tags
  };
}
