import type { UsageEventInput, UsageTags } from "./types";

type AnthropicUsageLike = {
  input_tokens?: number;
  output_tokens?: number;
};

export type AnthropicEventParams = {
  workspaceId: string;
  model: string;
  usage: AnthropicUsageLike | null | undefined;
  latencyMs: number;
  timestamp?: string | Date;
  costUsd?: number;
  tags: UsageTags;
  eventId?: string;
};

export function createAnthropicUsageEvent(params: AnthropicEventParams): UsageEventInput {
  return {
    eventId: params.eventId,
    workspaceId: params.workspaceId,
    provider: "anthropic",
    model: params.model,
    inputTokens: params.usage?.input_tokens ?? 0,
    outputTokens: params.usage?.output_tokens ?? 0,
    latencyMs: params.latencyMs,
    costUsd: params.costUsd,
    timestamp: params.timestamp ?? new Date(),
    tags: params.tags
  };
}
