import type {
  ClientConfig,
  IngestRequestPayload,
  IngestResponse,
  TrackResult,
  UsageEventBatchInput
} from "./types";
import { normalizeEvent } from "./validate";

const DEFAULT_ENDPOINT = "http://localhost:3000/api/ingest";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AISpendGuardClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly strict: boolean;
  private readonly defaultWorkspaceId?: string;
  private readonly logger: Pick<Console, "warn" | "error" | "info">;

  constructor(config: ClientConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error("apiKey is required");
    }

    this.apiKey = config.apiKey.trim();
    this.endpoint = (config.endpoint ?? DEFAULT_ENDPOINT).trim();
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.strict = config.strict ?? false;
    this.defaultWorkspaceId = config.defaultWorkspaceId;
    this.logger = config.logger ?? console;
  }

  async trackUsage(events: UsageEventBatchInput): Promise<TrackResult> {
    try {
      const list = Array.isArray(events) ? events : [events];
      if (list.length === 0) {
        throw new Error("at least one event is required");
      }

      const payload: IngestRequestPayload = {
        events: list.map((e) => normalizeEvent(e, this.defaultWorkspaceId))
      };

      const response = await this.sendWithRetry(payload);
      return { ok: true, response };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown SDK error";
      if (this.strict) {
        throw error;
      }
      this.logger.warn(`[aispendguard-sdk] ${message}`);
      return { ok: false, error: message };
    }
  }

  private async sendWithRetry(payload: IngestRequestPayload): Promise<IngestResponse> {
    let attempt = 0;
    let lastError: unknown = null;

    while (attempt <= this.maxRetries) {
      try {
        return await this.send(payload);
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries) {
          break;
        }
        const backoffMs = Math.min(1000 * 2 ** attempt, 4000);
        await sleep(backoffMs);
      }
      attempt += 1;
    }

    throw lastError instanceof Error ? lastError : new Error("request failed");
  }

  private async send(payload: IngestRequestPayload): Promise<IngestResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const raw = (await response.json().catch(() => null)) as IngestResponse | null;
      if (!response.ok) {
        const msg = raw?.errors?.join("; ") || `HTTP ${response.status}`;
        throw new Error(`ingest failed: ${msg}`);
      }

      if (!raw) {
        throw new Error("ingest failed: empty response body");
      }

      return raw;
    } finally {
      clearTimeout(timeout);
    }
  }
}
