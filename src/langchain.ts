/**
 * LangChain.js callback handler for AISpendGuard.
 *
 * Tracks LLM token usage from LangChain invocations via the SDK singleton.
 * Never reads prompt content or model outputs — only metadata and token counts.
 *
 * Usage:
 *   import { init, AISpendGuardCallbackHandler } from "@aispendguard/sdk";
 *
 *   init({ apiKey: "asg_..." });
 *   const handler = new AISpendGuardCallbackHandler({
 *     defaultTags: { feature: "chatbot", route: "/api/chat" },
 *   });
 *
 *   const llm = new ChatOpenAI({ callbacks: [handler] });
 */

import type { UsageEventInput, UsageTags } from "./types";
import { getClient } from "./index";

// ---------------------------------------------------------------------------
// LangChain types — we declare minimal interfaces to avoid a hard dependency
// on @langchain/core. At runtime the handler receives the real objects.
// ---------------------------------------------------------------------------

interface Serialized {
  id?: string[];
  name?: string;
  type?: string;
  lc?: number;
  [key: string]: unknown;
}

interface Generation {
  text: string;
  generationInfo?: Record<string, unknown>;
}

interface LLMResult {
  generations: Generation[][];
  llmOutput?: Record<string, unknown>;
}

interface BaseCallbackHandlerInput {
  [key: string]: unknown;
}

interface RunKwargs {
  run_id?: string;
  [key: string]: unknown;
}

/**
 * Minimal abstract base we implement. At runtime LangChain will duck-type
 * check the handler; it doesn't require `extends BaseCallbackHandler` from
 * the exact same package version — it only needs the method signatures and
 * the `name` property.
 */
abstract class BaseCallbackHandlerCompat {
  abstract name: string;
  lc_serializable = false;
  ignoreLLM = false;
  ignoreChain = true;
  ignoreAgent = true;
  ignoreRetriever = true;
  ignoreCustomEvent = true;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LangChainHandlerConfig {
  /** Default tags merged into every event. */
  defaultTags?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

const PROVIDER_PATTERNS: Array<[RegExp, string]> = [
  [/openai/i, "openai"],
  [/anthropic|claude/i, "anthropic"],
  [/google|gemini|vertex/i, "google"],
  [/cohere/i, "cohere"],
  [/mistral/i, "mistral"],
  [/bedrock/i, "aws_bedrock"],
  [/azure/i, "azure_openai"],
  [/ollama/i, "ollama"],
  [/groq/i, "groq"],
  [/together/i, "together"],
  [/fireworks/i, "fireworks"],
];

function detectProvider(serialized: Serialized | undefined): string {
  if (!serialized) return "unknown";

  // Check serialized id array (e.g. ["langchain", "chat_models", "openai", "ChatOpenAI"])
  const idStr = (serialized.id ?? []).join("/").toLowerCase();
  for (const [pattern, provider] of PROVIDER_PATTERNS) {
    if (pattern.test(idStr)) return provider;
  }

  // Check name
  const name = serialized.name ?? "";
  for (const [pattern, provider] of PROVIDER_PATTERNS) {
    if (pattern.test(name)) return provider;
  }

  return "unknown";
}

function extractModel(
  serialized: Serialized | undefined,
  llmOutput: Record<string, unknown> | undefined
): string {
  // Try llmOutput first (most reliable after completion)
  if (llmOutput) {
    const modelName =
      llmOutput.model ??
      llmOutput.model_name ??
      llmOutput.modelName ??
      llmOutput.model_id;
    if (typeof modelName === "string" && modelName.length > 0) {
      return modelName;
    }
  }

  // Try serialized kwargs
  if (serialized) {
    const kwargs = serialized.kwargs as Record<string, unknown> | undefined;
    if (kwargs) {
      const modelName =
        kwargs.model ??
        kwargs.model_name ??
        kwargs.modelName ??
        kwargs.model_id;
      if (typeof modelName === "string" && modelName.length > 0) {
        return modelName;
      }
    }
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type RunInfo = {
  startedAt: number;
  serialized?: Serialized;
};

export class AISpendGuardCallbackHandler extends BaseCallbackHandlerCompat {
  name = "AISpendGuardCallbackHandler";

  private readonly defaultTags: Record<string, string>;
  private readonly runs = new Map<string, RunInfo>();

  constructor(config?: LangChainHandlerConfig) {
    super();
    this.defaultTags = config?.defaultTags ?? {};
  }

  // -- LLM lifecycle callbacks --

  handleLLMStart(
    serialized: Serialized,
    _prompts: string[],
    runId?: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    _name?: string
  ): void {
    // Record start time. NEVER read prompts.
    const id = runId ?? crypto.randomUUID();
    this.runs.set(id, { startedAt: Date.now(), serialized });
  }

  handleChatModelStart(
    serialized: Serialized,
    _messages: unknown[][],
    runId?: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    _name?: string
  ): void {
    // Record start time. NEVER read messages.
    const id = runId ?? crypto.randomUUID();
    this.runs.set(id, { startedAt: Date.now(), serialized });
  }

  handleLLMEnd(
    output: LLMResult,
    runId?: string,
    _parentRunId?: string,
    _tags?: string[]
  ): void {
    const id = runId ?? "";
    const runInfo = this.runs.get(id);
    const startedAt = runInfo?.startedAt ?? Date.now();
    const serialized = runInfo?.serialized;

    // Clean up
    if (id) this.runs.delete(id);

    const latencyMs = Math.max(0, Date.now() - startedAt);

    // Extract token usage from llmOutput
    const llmOutput = output.llmOutput ?? {};
    const tokenUsage = (llmOutput.tokenUsage ??
      llmOutput.token_usage ??
      llmOutput.usage ??
      {}) as Record<string, unknown>;

    const inputTokens = toNumber(
      tokenUsage.promptTokens ??
        tokenUsage.prompt_tokens ??
        tokenUsage.input_tokens ??
        tokenUsage.totalInputTokens
    );
    const outputTokens = toNumber(
      tokenUsage.completionTokens ??
        tokenUsage.completion_tokens ??
        tokenUsage.output_tokens ??
        tokenUsage.totalOutputTokens
    );

    // Skip if we got no token data at all
    if (inputTokens === 0 && outputTokens === 0) return;

    const provider = detectProvider(serialized);
    const model = extractModel(serialized, llmOutput);

    // Build tags
    const tags: UsageTags = {
      ...this.defaultTags,
      source: "langchain",
      task_type: this.defaultTags.task_type ?? "chat",
      feature: this.defaultTags.feature ?? "default",
      route: this.defaultTags.route ?? "default",
    };

    const event: UsageEventInput = {
      provider,
      model,
      inputTokens,
      outputTokens,
      latencyMs,
      timestamp: new Date(),
      tags,
      // Use run_id as event_id for deduplication
      ...(id ? { eventId: `langchain:${id}` } : {}),
    };

    // Fire and forget — never block the LLM chain
    const client = getClientSafe();
    if (client) {
      client.trackUsage(event).catch((err) => {
        console.warn(
          `[aispendguard-langchain] Failed to track usage: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      });
    }
  }

  handleLLMError(
    _err: Error,
    runId?: string
  ): void {
    // Clean up run tracking; never throw
    const id = runId ?? "";
    if (id) this.runs.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function getClientSafe() {
  try {
    return getClient();
  } catch {
    console.warn(
      "[aispendguard-langchain] SDK not initialized. Call init() before using the LangChain handler."
    );
    return null;
  }
}
