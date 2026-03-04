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
  workspaceId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd?: number;
  timestamp: string | Date;
  tags: UsageTags;
};

export type UsageEventBatchInput = UsageEventInput | UsageEventInput[];

export type IngestEventPayload = {
  event_id?: string;
  workspace_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
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
  defaultWorkspaceId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  strict?: boolean;
  logger?: Pick<Console, "warn" | "error" | "info">;
};

export type TrackResult =
  | { ok: true; response: IngestResponse }
  | { ok: false; error: string };
