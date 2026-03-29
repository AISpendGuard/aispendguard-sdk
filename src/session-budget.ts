import type { UsageEventBatchInput, UsageEventInput, TrackResult } from "./types";
import { estimateEventCost } from "./pricing";
import type { PriceEntry } from "./pricing";
import { getClient } from "./index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoopDetectionConfig = {
  /** Max calls within the window before triggering. Default: 20. */
  maxCalls: number;
  /** Sliding window in ms. Default: 10000 (10s). */
  windowMs: number;
};

export type SessionBudgetInfo = {
  currentSpendUsd: number;
  maxBudgetUsd: number;
  callCount: number;
  action: "soft_limit" | "hard_limit" | "loop_detected";
};

export type SessionBudgetConfig = {
  /** Hard budget limit in USD. Must be > 0. */
  maxBudget: number;
  /** Percentage (1-99) at which soft limit callback fires. Default: 90. */
  softLimitPercent?: number;
  /** Called once when cumulative spend crosses soft limit. */
  onSoftLimit?: (info: SessionBudgetInfo) => void;
  /** Called once when cumulative spend would exceed hard limit. */
  onHardLimit?: (info: SessionBudgetInfo) => void;
  /** Loop detection config. Disabled if omitted. */
  loopDetection?: LoopDetectionConfig;
  /** Called when loop detected. */
  onLoopDetected?: (info: SessionBudgetInfo) => void;
  /** Custom pricing overrides (merged with bundled pricing). */
  pricing?: Map<string, PriceEntry>;
  /** Logger for warnings (model not found, etc.). Default: console. */
  logger?: Pick<Console, "warn">;
};

// ---------------------------------------------------------------------------
// SessionBudget class
// ---------------------------------------------------------------------------

export class SessionBudget {
  private cumulativeSpendUsd = 0;
  private callCount = 0;
  private callTimestamps: number[] = [];
  private softLimitFired = false;
  private hardLimitFired = false;
  private lastTags: { feature?: string; route?: string; traceId?: string } = {};

  private readonly maxBudget: number;
  private readonly softLimitPercent: number;
  private readonly onSoftLimit?: (info: SessionBudgetInfo) => void;
  private readonly onHardLimit?: (info: SessionBudgetInfo) => void;
  private readonly loopDetection?: LoopDetectionConfig;
  private readonly onLoopDetected?: (info: SessionBudgetInfo) => void;
  private readonly pricing?: Map<string, PriceEntry>;
  private readonly logger: Pick<Console, "warn">;

  constructor(config: SessionBudgetConfig) {
    if (config.maxBudget <= 0) {
      throw new Error("maxBudget must be > 0");
    }
    if (
      config.softLimitPercent !== undefined &&
      (config.softLimitPercent < 1 || config.softLimitPercent > 99)
    ) {
      throw new Error("softLimitPercent must be between 1 and 99");
    }

    this.maxBudget = config.maxBudget;
    this.softLimitPercent = config.softLimitPercent ?? 90;
    this.onSoftLimit = config.onSoftLimit;
    this.onHardLimit = config.onHardLimit;
    this.loopDetection = config.loopDetection;
    this.onLoopDetected = config.onLoopDetected;
    this.pricing = config.pricing;
    this.logger = config.logger ?? console;
  }

  /**
   * Track usage through the session budget guard.
   * Estimates cost, checks limits, then forwards to the SDK client.
   * Returns `{ ok: false }` if hard limit or loop detected.
   */
  async trackUsage(events: UsageEventBatchInput): Promise<TrackResult> {
    const list = Array.isArray(events) ? events : [events];

    // Estimate cost for the batch
    let estimatedCost = 0;
    for (const event of list) {
      const cost = estimateEventCost(event, this.pricing);
      if (cost === null) {
        this.logger.warn(
          `[aispendguard-sdk] SessionBudget: unknown model "${event.provider}/${event.model}" — treating as $0 cost`
        );
        // Unknown model = $0, don't block
      } else {
        estimatedCost += cost;
      }
    }

    // Store last event tags for enforcement event context
    const lastEvent = list[list.length - 1];
    if (lastEvent) {
      this.storeLastTags(lastEvent);
    }

    this.callCount += 1;

    // Loop detection (if configured)
    if (this.loopDetection) {
      const now = Date.now();
      this.callTimestamps.push(now);
      // Prune entries older than windowMs
      const cutoff = now - this.loopDetection.windowMs;
      while (this.callTimestamps.length > 0 && this.callTimestamps[0] < cutoff) {
        this.callTimestamps.shift();
      }
      if (this.callTimestamps.length >= this.loopDetection.maxCalls) {
        const info = this.buildInfo("loop_detected");
        this.onLoopDetected?.(info);
        this.sendEnforcementEvent("loop_detected").catch(() => {});
        return { ok: false, error: "loop_detected" };
      }
    }

    // Hard limit check
    if (this.cumulativeSpendUsd + estimatedCost > this.maxBudget) {
      if (!this.hardLimitFired) {
        this.hardLimitFired = true;
        const info = this.buildInfo("hard_limit");
        this.onHardLimit?.(info);
        this.sendEnforcementEvent("hard_limit").catch(() => {});
      }
      return { ok: false, error: "session_budget_exceeded" };
    }

    // Reserve spend (synchronous — before any async gap)
    this.cumulativeSpendUsd += estimatedCost;

    // Soft limit check
    const softThreshold = this.maxBudget * this.softLimitPercent / 100;
    if (!this.softLimitFired && this.cumulativeSpendUsd >= softThreshold) {
      this.softLimitFired = true;
      const info = this.buildInfo("soft_limit");
      this.onSoftLimit?.(info);
      this.sendEnforcementEvent("soft_limit").catch(() => {});
    }

    // Forward to SDK client
    return getClient().trackUsage(events);
  }

  /** Current cumulative spend in this session. */
  get currentSpend(): number {
    return this.cumulativeSpendUsd;
  }

  /** Whether the hard limit has been reached. */
  get isExceeded(): boolean {
    return this.cumulativeSpendUsd >= this.maxBudget;
  }

  /** Number of calls tracked in this session. */
  get totalCalls(): number {
    return this.callCount;
  }

  /** Reset the session budget (start fresh). */
  reset(): void {
    this.cumulativeSpendUsd = 0;
    this.callCount = 0;
    this.callTimestamps = [];
    this.softLimitFired = false;
    this.hardLimitFired = false;
    this.lastTags = {};
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private storeLastTags(event: UsageEventInput): void {
    const tags = event.tags;
    this.lastTags = {
      feature: typeof tags?.feature === "string" ? tags.feature : undefined,
      route: typeof tags?.route === "string" ? tags.route : undefined,
      traceId: event.traceId ?? undefined,
    };
  }

  private buildInfo(action: SessionBudgetInfo["action"]): SessionBudgetInfo {
    return {
      currentSpendUsd: this.cumulativeSpendUsd,
      maxBudgetUsd: this.maxBudget,
      callCount: this.callCount,
      action,
    };
  }

  private async sendEnforcementEvent(action: "soft_limit" | "hard_limit" | "loop_detected"): Promise<void> {
    try {
      await getClient().trackUsage({
        provider: "aispendguard",
        model: "session-budget",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        timestamp: new Date().toISOString(),
        tags: {
          task_type: "budget_enforcement",
          feature: this.lastTags.feature ?? "session-budget",
          route: this.lastTags.route ?? "session-budget",
          enforcement_action: action,
          session_budget_usd: this.maxBudget.toFixed(2),
          session_spend_usd: this.cumulativeSpendUsd.toFixed(2),
          session_call_count: String(this.callCount),
        },
        ...(this.lastTags.traceId ? { traceId: this.lastTags.traceId } : {}),
      });
    } catch {
      // Fire-and-forget — enforcement event failures never block user code
    }
  }
}
