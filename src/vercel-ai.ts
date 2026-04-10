import { getClient } from "./index";
import type { VercelAIOnFinishResult, VercelAIConfig, UsageEventInput } from "./types";

/**
 * Detect provider from Vercel AI SDK modelId string.
 * Same heuristics as wrap-openai.ts / wrap-anthropic.ts.
 */
function detectProvider(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("o1-") || m.startsWith("o3-") || m.startsWith("o4-")) return "openai";
  if (m.startsWith("claude-")) return "anthropic";
  if (m.startsWith("gemini-")) return "google";
  if (m.startsWith("command-")) return "cohere";
  if (m.startsWith("mistral-") || m.startsWith("mixtral-")) return "mistral";
  return "unknown";
}

/**
 * Create a UsageEventInput from a Vercel AI SDK onFinish result.
 * Pure function — does not send the event.
 *
 * Privacy: Only reads result.usage and result.response metadata.
 * NEVER reads result.text, result.toolCalls, result.toolResults, result.object, or result.rawResponse.
 */
export function createVercelAIUsageEvent(
  result: VercelAIOnFinishResult,
  config?: VercelAIConfig
): UsageEventInput {
  const modelId = result.response?.modelId ?? "unknown";
  const provider = config?.provider ?? detectProvider(modelId);
  const now = Date.now();
  const startTime = result.response?.timestamp?.getTime?.() ?? now;
  const latencyMs = Math.max(0, now - startTime);

  return {
    provider,
    model: modelId,
    inputTokens: result.usage.promptTokens,
    outputTokens: result.usage.completionTokens,
    latencyMs,
    timestamp: new Date(),
    tags: {
      source: "vercel-ai",
      provider,
      model: modelId,
      task_type: "chat",
      feature: "default",
      route: "default",
      ...(config?.defaultTags ?? {}),
    },
  };
}

/**
 * Factory: returns an onFinish callback for generateText/streamText/generateObject.
 *
 * Usage:
 *   const result = await generateText({
 *     model: openai("gpt-4o"),
 *     prompt: "Hello",
 *     onFinish: createAISDKOnFinish({ defaultTags: { feature: "chat" } }),
 *   });
 */
export function createAISDKOnFinish(
  config?: VercelAIConfig
): (result: VercelAIOnFinishResult) => void {
  return (result: VercelAIOnFinishResult) => {
    try {
      const event = createVercelAIUsageEvent(result, config);
      getClient().trackUsage(event);
    } catch {
      // Fire-and-forget — tracking failures never break user code
    }
  };
}
