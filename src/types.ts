export type AllowedTagKey =
  | "task_type"
  | "feature"
  | "route"
  | "customer_plan"
  | "customer_id"
  | "provider"
  | "model"
  | "environment"
  | "agent_name"
  | "trace_id"
  | "parent_id";

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
  /** Trace identifier for grouping multi-step agent executions. */
  traceId?: string;
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
  trace_id?: string;
  latency_ms: number;
  cost_usd?: number;
  timestamp: string;
  tags: Record<string, TagValue>;
};

export type IngestRequestPayload = {
  events: IngestEventPayload[];
};

export type EnforcementAction = "warn" | "block" | "downgrade" | "throttle";

export type EnforcementSignal = {
  action: EnforcementAction;
  reason: string;
  budget_limit?: number;
  current_spend?: number;
  current_percent?: number;
  suggested_model?: string;
  backoff_ms?: number;
  source?: "workspace" | "tag";
  tag_key?: string;
  tag_value?: string;
};

export type IngestResponse = {
  accepted: number;
  duplicates: number;
  rejected: number;
  errors?: string[];
  enforcement?: EnforcementSignal;
};

export type CheckBudgetOptions = {
  estimatedCost?: number;
};

export type CheckBudgetResult = {
  hasBudget: boolean;
  monthlyLimitUsd: number | null;
  currentSpendUsd: number | null;
  percentUsed: number | null;
  enforceLimit: boolean;
  exceeded: boolean;
  wouldExceed?: boolean;
  triggeredRule?: {
    thresholdPercent: number;
    action: string;
  } | null;
};

export type BudgetExceededInfo = {
  limitUsd: number;
  currentSpendUsd: number;
  retryAfterMs: number;
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
  /** Called once when the API reports budget exceeded (429 + X-Budget-Exceeded header). */
  onBudgetExceeded?: (info: BudgetExceededInfo) => void;
  /** How long to pause sending after budget exceeded (ms). Default: 300000 (5 min). */
  budgetBackoffMs?: number;
};

export type TrackResult =
  | { ok: true; response: IngestResponse }
  | { ok: false; error: string };

/** Subset of Vercel AI SDK onFinish result — only the fields we read (privacy-safe). */
export type VercelAIOnFinishResult = {
  usage: { promptTokens: number; completionTokens: number };
  response: {
    modelId?: string;
    timestamp?: Date;
    headers?: Record<string, string>;
  };
  finishReason?: string;
  // text?: string;        // NEVER READ — privacy invariant
  // toolCalls?: unknown;  // NEVER READ
  // toolResults?: unknown; // NEVER READ
};

export type VercelAIConfig = {
  /** Additional tags to merge into every event. */
  defaultTags?: Record<string, string>;
  /** Override provider detection. If not set, auto-detected from modelId. */
  provider?: string;
};

/** Input for the simplified cost estimation function. */
export type CostEstimateInput = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Cached input tokens (billed at reduced rate). */
  cachedTokens?: number;
  /** Cache write tokens (Anthropic: 1.25×/2.0× premium). */
  cacheWriteTokens?: number;
  /** Anthropic cache TTL: "5m" (default) or "1h" (extended). */
  cacheTtl?: "5m" | "1h";
  /** Whether this will use the Batch API (50% discount). */
  batchMode?: boolean;
  /** Whether fast mode is used (6× multiplier). */
  fastMode?: boolean;
  /** Number of web search calls (flat fee per call). */
  webSearchCount?: number;
};

/** Structured cost breakdown returned by estimateCost(). */
export type CostEstimate = {
  /** Total estimated cost in USD. */
  estimatedCostUsd: number;
  /** Cost attributed to input tokens. */
  inputCostUsd: number;
  /** Cost attributed to output tokens. */
  outputCostUsd: number;
  /** Cost attributed to tool calls (web search fees). */
  toolCostUsd: number;
  /** Normalized model identifier used for lookup. */
  model: string;
  /** Price per 1M input tokens (from pricing source). */
  pricePerInputToken: number;
  /** Price per 1M output tokens (from pricing source). */
  pricePerOutputToken: number;
};

export type { SessionBudgetConfig, SessionBudgetInfo, LoopDetectionConfig } from "./session-budget";
export type { PriceEntry } from "./pricing";
