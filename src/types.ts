export type AllowedTagKey =
  | "task_type"
  | "feature"
  | "route"
  | "customer_plan"
  | "customer_id"
  | "provider"
  | "model"
  | "environment"
  | "agent_name";

export type TagValue = string | string[];
export type UsageTags = Partial<Record<AllowedTagKey, string>> & Record<string, TagValue>;

export type UsageEventInput = {
  eventId?: string;
  provider: string;
  model: string;
  /** Resolved model name from provider response (e.g. "gpt-4o-mini-2024-07-18" vs "gpt-4o-mini"). */
  resolvedModel?: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Cache read tokens — billed at a reduced rate.
   * OpenAI: 0.5× base input price. Anthropic: 0.1× base input price.
   * Already included in inputTokens; stored separately for accurate cost calculation.
   */
  inputTokensCached?: number;
  /**
   * Cache write tokens — billed at a premium rate (Anthropic only: 1.25× base input price).
   * Already included in inputTokens; stored separately for accurate cost calculation.
   */
  inputTokensCacheWrite?: number;
  /**
   * Reasoning / thinking tokens — billed as output tokens.
   * OpenAI o1/o3: from completion_tokens_details.reasoning_tokens.
   * Google Gemini 2.5: from usageMetadata.thoughtsTokenCount.
   * Anthropic extended thinking: included in output_tokens (not separately reported in usage).
   * Already included in outputTokens; stored separately for cost spike detection.
   */
  thinkingTokens?: number;
  /**
   * Anthropic cache write TTL: "5m" (default, 1.25× input price) or "1h" (extended, 2.0× input price).
   * Only relevant when inputTokensCacheWrite > 0.
   */
  cacheTtl?: "5m" | "1h";
  /** Number of web search tool calls (billed as flat fee per call). */
  webSearchCount?: number;
  /** Number of web fetch tool calls (billed as flat fee per call). */
  webFetchCount?: number;
  /** Whether this request used the Batch API (50% discount on token costs). */
  isBatchApi?: boolean;
  /** Whether fast mode was used (Opus 6× multiplier on token costs). */
  isFastMode?: boolean;
  latencyMs: number;
  costUsd?: number;
  timestamp: string | Date;
  tags: UsageTags;
};

export type UsageEventBatchInput = UsageEventInput | UsageEventInput[];

export type IngestEventPayload = {
  event_id?: string;
  provider: string;
  model: string;
  resolved_model?: string;
  input_tokens: number;
  output_tokens: number;
  input_tokens_cached?: number;
  input_tokens_cache_write?: number;
  thinking_tokens?: number;
  cache_ttl?: "5m" | "1h";
  web_search_count?: number;
  web_fetch_count?: number;
  is_batch_api?: boolean;
  is_fast_mode?: boolean;
  latency_ms: number;
  cost_usd?: number;
  timestamp: string;
  tags: Record<string, TagValue>;
};

export type IngestRequestPayload = {
  events: IngestEventPayload[];
};

export type IngestResponse = {
  accepted: number;
  duplicates: number;
  rejected: number;
  errors?: string[];
};

export type ClientConfig = {
  apiKey: string;
  endpoint?: string;
  /** Default tags merged into every auto-wrapped event. */
  defaultTags?: UsageTags;
  timeoutMs?: number;
  maxRetries?: number;
  strict?: boolean;
  logger?: Pick<Console, "warn" | "error" | "info">;
};

export type TrackResult =
  | { ok: true; response: IngestResponse }
  | { ok: false; error: string };
