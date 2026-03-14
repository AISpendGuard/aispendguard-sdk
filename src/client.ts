import type {
  ClientConfig,
  IngestRequestPayload,
  IngestResponse,
  TrackResult,
  UsageEventBatchInput,
  UsageTags
} from "./types";
import { normalizeEvent } from "./validate";

const DEFAULT_ENDPOINT = "https://www.aispendguard.com/api/ingest";
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
  readonly defaultTags?: UsageTags;
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
    this.defaultTags = config.defaultTags;
    this.logger = config.logger ?? console;
  }

  async trackUsage(events: UsageEventBatchInput): Promise<TrackResult> {
    try {
      const list = Array.isArray(events) ? events : [events];
      if (list.length === 0) {
        throw new Error("at least one event is required");
      }

      const payload: IngestRequestPayload = {
        events: list.map((e) => normalizeEvent(e))
      };

      const response = await this.sendWithRetry(payload);
      return { ok: true, response };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown SDK error";
      if (this.strict) {
        throw error;
      }
      this.logger.warn(`[aispendguard-sdk] tracking failed: ${message}. Use { strict: true } to throw on errors.`);
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

      if (response.redirected) {
        throw new Error(
          `ingest failed: redirected to ${response.url} — update your endpoint to "${response.url}"`
        );
      }

      const raw = (await response.json().catch(() => null)) as IngestResponse | null;
      if (!response.ok) {
        const msg = raw?.errors?.join("; ") || `HTTP ${response.status} ${response.statusText}`;
        throw new Error(`ingest failed (${this.endpoint}): ${msg}`);
      }

      if (!raw) {
        throw new Error("ingest failed: empty response body");
      }

      return raw;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`ingest failed: request to ${this.endpoint} timed out after ${this.timeoutMs}ms`);
      }
      if (err instanceof TypeError) {
        throw new Error(`ingest failed: network error reaching ${this.endpoint} — ${err.message}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
