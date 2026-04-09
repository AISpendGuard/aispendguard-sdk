import type {
  BudgetExceededInfo,
  CheckBudgetOptions,
  CheckBudgetResult,
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

class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class AISpendGuardClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly strict: boolean;
  readonly defaultTags?: UsageTags;
  private readonly logger: Pick<Console, "warn" | "error" | "info">;

  // Circuit breaker state for budget enforcement
  private budgetExceeded = false;
  private budgetExceededUntil = 0;
  private budgetExceededLogged = false;
  private readonly budgetBackoffMs: number;
  private readonly onBudgetExceeded?: (info: BudgetExceededInfo) => void;

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
    this.budgetBackoffMs = config.budgetBackoffMs ?? 300_000; // 5 min
    this.onBudgetExceeded = config.onBudgetExceeded;
  }

  /** Derive the budget endpoint from the ingest endpoint base URL. */
  private get budgetEndpoint(): string {
    // Endpoint is typically "https://www.aispendguard.com/api/ingest"
    // Budget endpoint is "https://www.aispendguard.com/api/v1/budget"
    try {
      const url = new URL(this.endpoint);
      url.pathname = url.pathname.replace(/\/api\/ingest\/?$/, "/api/v1/budget");
      return url.toString();
    } catch {
      // Fallback: strip /api/ingest and append /api/v1/budget
      return this.endpoint.replace(/\/api\/ingest\/?$/, "/api/v1/budget");
    }
  }

  /**
   * Check current budget status before making an AI API call.
   * Returns budget state including whether an estimated cost would exceed limits.
   */
  async checkBudget(options?: CheckBudgetOptions): Promise<CheckBudgetResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let url = this.budgetEndpoint;
      if (options?.estimatedCost != null) {
        const cost = options.estimatedCost;
        if (!Number.isFinite(cost) || cost < 0) {
          throw new Error("estimatedCost must be a finite non-negative number");
        }
        url += `?estimatedCost=${cost}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: { "x-api-key": this.apiKey },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`budget check failed: HTTP ${response.status}`);
      }

      const data = await response.json() as {
        budget: {
          monthlyLimitUsd: number;
          currentSpendUsd: number;
          percentUsed: number;
          enforceLimit: boolean;
          exceeded: boolean;
          wouldExceed?: boolean;
          triggeredRule?: { thresholdPercent: number; action: string } | null;
        } | null;
      };

      if (!data.budget) {
        return {
          hasBudget: false,
          monthlyLimitUsd: null,
          currentSpendUsd: null,
          percentUsed: null,
          enforceLimit: false,
          exceeded: false,
        };
      }

      return {
        hasBudget: true,
        monthlyLimitUsd: data.budget.monthlyLimitUsd,
        currentSpendUsd: data.budget.currentSpendUsd,
        percentUsed: data.budget.percentUsed,
        enforceLimit: data.budget.enforceLimit,
        exceeded: data.budget.exceeded,
        wouldExceed: data.budget.wouldExceed,
        triggeredRule: data.budget.triggeredRule,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`budget check timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async trackUsage(events: UsageEventBatchInput): Promise<TrackResult> {
    // Circuit breaker: silently drop events while budget exceeded
    if (this.budgetExceeded) {
      if (Date.now() < this.budgetExceededUntil) {
        return { ok: false, error: "budget exceeded (circuit breaker)" };
      }
      // Backoff expired — send probe to check if budget was increased
      this.budgetExceeded = false;
      this.budgetExceededLogged = false;
    }

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
        // Don't retry on budget exceeded — skip straight to circuit breaker
        if (error instanceof BudgetExceededError) {
          throw error;
        }
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

      // Budget enforcement: detect 429 + X-Budget-Exceeded header
      if (response.status === 429 && response.headers.get("x-budget-exceeded") === "true") {
        const limitUsd = parseFloat(response.headers.get("x-budget-limit") ?? "0");
        const currentSpendUsd = parseFloat(response.headers.get("x-budget-current") ?? "0");

        this.budgetExceeded = true;
        this.budgetExceededUntil = Date.now() + this.budgetBackoffMs;

        if (!this.budgetExceededLogged) {
          this.budgetExceededLogged = true;
          this.logger.warn(
            `[aispendguard-sdk] budget exceeded: spend $${currentSpendUsd.toFixed(2)} >= limit $${limitUsd.toFixed(2)}. ` +
            `Pausing event sending for ${Math.round(this.budgetBackoffMs / 1000)}s.`
          );
          this.onBudgetExceeded?.({
            limitUsd,
            currentSpendUsd,
            retryAfterMs: this.budgetBackoffMs,
          });
        }

        throw new BudgetExceededError(
          `budget exceeded: spend $${currentSpendUsd.toFixed(2)} >= limit $${limitUsd.toFixed(2)}`
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

      // Enforcement body parsing: activate circuit breaker on block action
      if (raw.enforcement?.action === "block") {
        const limitUsd = raw.enforcement.budget_limit ?? 0;
        const currentSpendUsd = raw.enforcement.current_spend ?? 0;

        this.budgetExceeded = true;
        this.budgetExceededUntil = Date.now() + this.budgetBackoffMs;

        if (!this.budgetExceededLogged) {
          this.budgetExceededLogged = true;
          this.logger.warn(
            `[aispendguard-sdk] budget enforcement: action=block spend=$${currentSpendUsd.toFixed(2)} limit=$${limitUsd.toFixed(2)}. ` +
            `Pausing event sending for ${Math.round(this.budgetBackoffMs / 1000)}s.`
          );
          this.onBudgetExceeded?.({
            limitUsd,
            currentSpendUsd,
            retryAfterMs: this.budgetBackoffMs,
          });
        }
      }

      return raw;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        throw err;
      }
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
