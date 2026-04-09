import { AISpendGuardClient } from "./client";
import type { CheckBudgetOptions, CheckBudgetResult, ClientConfig, TrackResult, UsageEventBatchInput } from "./types";

let defaultClient: AISpendGuardClient | null = null;

export function init(config: ClientConfig): AISpendGuardClient {
  defaultClient = new AISpendGuardClient(config);
  return defaultClient;
}

export function getClient(): AISpendGuardClient {
  if (!defaultClient) {
    throw new Error("AISpendGuard SDK is not initialized. Call init(...) first.");
  }
  return defaultClient;
}

export async function trackUsage(events: UsageEventBatchInput): Promise<TrackResult> {
  return getClient().trackUsage(events);
}

export async function checkBudget(options?: CheckBudgetOptions): Promise<CheckBudgetResult> {
  return getClient().checkBudget(options);
}

export { AISpendGuardClient };
export { SessionBudget } from "./session-budget";
export { estimateEventCost } from "./pricing";
export { createOpenAIUsageEvent } from "./openai";
export { createAnthropicUsageEvent } from "./anthropic";
export { createGeminiUsageEvent } from "./gemini";
export { AISpendGuardCallbackHandler } from "./langchain";
export { wrapOpenAI } from "./wrap-openai";
export { wrapAnthropic } from "./wrap-anthropic";
export { wrapGemini } from "./wrap-gemini";
export type { LangChainHandlerConfig } from "./langchain";
export type { AnthropicEventParams } from "./anthropic";
export type { OpenAIEventParams } from "./openai";
export type { GeminiEventParams } from "./gemini";
export type {
  AllowedTagKey,
  BudgetExceededInfo,
  ClientConfig,
  IngestEventPayload,
  IngestRequestPayload,
  IngestResponse,
  TrackResult,
  UsageEventBatchInput,
  UsageEventInput,
  UsageTags,
  SessionBudgetConfig,
  SessionBudgetInfo,
  LoopDetectionConfig,
  PriceEntry,
  CheckBudgetOptions,
  CheckBudgetResult,
  EnforcementAction,
  EnforcementSignal
} from "./types";
