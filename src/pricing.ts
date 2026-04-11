import type { UsageEventInput, CostEstimateInput, CostEstimate } from "./types";

// ---------------------------------------------------------------------------
// Bundled static pricing table
// Ported from aispendguard-app/lib/model-pricing.ts HARDCODED_PRICES
// Last verified: 2026-03-05
// ---------------------------------------------------------------------------

export type PriceEntry = {
  provider: string;
  model: string;
  inputPer1MTokens: number;
  outputPer1MTokens: number;
};

const PRICES: Array<[string, PriceEntry]> = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  ["openai/gpt-4o",              { provider: "openai", model: "gpt-4o",              inputPer1MTokens: 2.50,  outputPer1MTokens: 10.00 }],
  ["openai/gpt-4o-mini",         { provider: "openai", model: "gpt-4o-mini",         inputPer1MTokens: 0.15,  outputPer1MTokens: 0.60  }],
  ["openai/gpt-4-turbo",         { provider: "openai", model: "gpt-4-turbo",         inputPer1MTokens: 10.00, outputPer1MTokens: 30.00 }],
  ["openai/gpt-4-turbo-preview", { provider: "openai", model: "gpt-4-turbo-preview", inputPer1MTokens: 10.00, outputPer1MTokens: 30.00 }],
  ["openai/gpt-3.5-turbo",       { provider: "openai", model: "gpt-3.5-turbo",       inputPer1MTokens: 0.50,  outputPer1MTokens: 1.50  }],
  ["openai/o1",                  { provider: "openai", model: "o1",                  inputPer1MTokens: 15.00, outputPer1MTokens: 60.00 }],
  ["openai/gpt-4.1",             { provider: "openai", model: "gpt-4.1",             inputPer1MTokens: 2.00,  outputPer1MTokens: 8.00  }],
  ["openai/gpt-4.1-mini",        { provider: "openai", model: "gpt-4.1-mini",        inputPer1MTokens: 0.40,  outputPer1MTokens: 1.60  }],
  ["openai/gpt-4.1-nano",        { provider: "openai", model: "gpt-4.1-nano",        inputPer1MTokens: 0.10,  outputPer1MTokens: 0.40  }],
  ["openai/o1-mini",             { provider: "openai", model: "o1-mini",             inputPer1MTokens: 1.10,  outputPer1MTokens: 4.40  }],
  ["openai/o3",                  { provider: "openai", model: "o3",                  inputPer1MTokens: 2.00,  outputPer1MTokens: 8.00  }],
  ["openai/o3-mini",             { provider: "openai", model: "o3-mini",             inputPer1MTokens: 1.10,  outputPer1MTokens: 4.40  }],
  ["openai/o4-mini",             { provider: "openai", model: "o4-mini",             inputPer1MTokens: 1.10,  outputPer1MTokens: 4.40  }],

  // ── Anthropic ───────────────────────────────────────────────────────────
  ["anthropic/claude-opus-4-6",              { provider: "anthropic", model: "claude-opus-4-6",              inputPer1MTokens: 5.00,  outputPer1MTokens: 25.00 }],
  ["anthropic/claude-opus-4-5",              { provider: "anthropic", model: "claude-opus-4-5",              inputPer1MTokens: 5.00,  outputPer1MTokens: 25.00 }],
  ["anthropic/claude-opus-4-1",              { provider: "anthropic", model: "claude-opus-4-1",              inputPer1MTokens: 15.00, outputPer1MTokens: 75.00 }],
  ["anthropic/claude-opus-4",                { provider: "anthropic", model: "claude-opus-4",                inputPer1MTokens: 15.00, outputPer1MTokens: 75.00 }],
  ["anthropic/claude-sonnet-4-6",            { provider: "anthropic", model: "claude-sonnet-4-6",            inputPer1MTokens: 3.00,  outputPer1MTokens: 15.00 }],
  ["anthropic/claude-sonnet-4-5",            { provider: "anthropic", model: "claude-sonnet-4-5",            inputPer1MTokens: 3.00,  outputPer1MTokens: 15.00 }],
  ["anthropic/claude-sonnet-4",              { provider: "anthropic", model: "claude-sonnet-4",              inputPer1MTokens: 3.00,  outputPer1MTokens: 15.00 }],
  ["anthropic/claude-haiku-4-5",             { provider: "anthropic", model: "claude-haiku-4-5",             inputPer1MTokens: 1.00,  outputPer1MTokens: 5.00  }],
  ["anthropic/claude-3-7-sonnet-20250219",   { provider: "anthropic", model: "claude-3-7-sonnet-20250219",   inputPer1MTokens: 3.00,  outputPer1MTokens: 15.00 }],
  ["anthropic/claude-3-5-sonnet-20241022",   { provider: "anthropic", model: "claude-3-5-sonnet-20241022",   inputPer1MTokens: 3.00,  outputPer1MTokens: 15.00 }],
  ["anthropic/claude-3-5-sonnet-latest",     { provider: "anthropic", model: "claude-3-5-sonnet-latest",     inputPer1MTokens: 3.00,  outputPer1MTokens: 15.00 }],
  ["anthropic/claude-3-5-haiku-20241022",    { provider: "anthropic", model: "claude-3-5-haiku-20241022",    inputPer1MTokens: 0.80,  outputPer1MTokens: 4.00  }],
  ["anthropic/claude-3-5-haiku-latest",      { provider: "anthropic", model: "claude-3-5-haiku-latest",      inputPer1MTokens: 0.80,  outputPer1MTokens: 4.00  }],
  ["anthropic/claude-3-opus-20240229",       { provider: "anthropic", model: "claude-3-opus-20240229",       inputPer1MTokens: 15.00, outputPer1MTokens: 75.00 }],
  ["anthropic/claude-3-opus-latest",         { provider: "anthropic", model: "claude-3-opus-latest",         inputPer1MTokens: 15.00, outputPer1MTokens: 75.00 }],
  ["anthropic/claude-3-haiku-20240307",      { provider: "anthropic", model: "claude-3-haiku-20240307",      inputPer1MTokens: 0.25,  outputPer1MTokens: 1.25  }],
  ["anthropic/claude-3-sonnet-20240229",     { provider: "anthropic", model: "claude-3-sonnet-20240229",     inputPer1MTokens: 3.00,  outputPer1MTokens: 15.00 }],

  // ── Google Gemini ───────────────────────────────────────────────────────
  ["google/gemini-3.1-pro-preview",        { provider: "google", model: "gemini-3.1-pro-preview",        inputPer1MTokens: 2.00,  outputPer1MTokens: 12.00 }],
  ["google/gemini-3.1-flash-lite-preview", { provider: "google", model: "gemini-3.1-flash-lite-preview", inputPer1MTokens: 0.25,  outputPer1MTokens: 1.50  }],
  ["google/gemini-2.5-pro",               { provider: "google", model: "gemini-2.5-pro",                inputPer1MTokens: 1.25,  outputPer1MTokens: 10.00 }],
  ["google/gemini-2.5-flash",             { provider: "google", model: "gemini-2.5-flash",              inputPer1MTokens: 0.30,  outputPer1MTokens: 2.50  }],
  ["google/gemini-2.5-flash-lite",        { provider: "google", model: "gemini-2.5-flash-lite",         inputPer1MTokens: 0.10,  outputPer1MTokens: 0.40  }],
  ["google/gemini-2.0-flash",             { provider: "google", model: "gemini-2.0-flash",              inputPer1MTokens: 0.10,  outputPer1MTokens: 0.40  }],
  ["google/gemini-2.0-flash-lite",        { provider: "google", model: "gemini-2.0-flash-lite",         inputPer1MTokens: 0.075, outputPer1MTokens: 0.30  }],
  ["google/gemini-1.5-pro",               { provider: "google", model: "gemini-1.5-pro",                inputPer1MTokens: 1.25,  outputPer1MTokens: 5.00  }],
  ["google/gemini-1.5-flash",             { provider: "google", model: "gemini-1.5-flash",              inputPer1MTokens: 0.075, outputPer1MTokens: 0.30  }],
  ["google/gemini-1.5-flash-8b",          { provider: "google", model: "gemini-1.5-flash-8b",           inputPer1MTokens: 0.0375,outputPer1MTokens: 0.15  }],

  // ── Mistral ─────────────────────────────────────────────────────────────
  ["mistral/mistral-large-latest",  { provider: "mistral", model: "mistral-large-latest",  inputPer1MTokens: 2.00, outputPer1MTokens: 6.00 }],
  ["mistral/mistral-medium-latest", { provider: "mistral", model: "mistral-medium-latest", inputPer1MTokens: 0.40, outputPer1MTokens: 2.00 }],
  ["mistral/mistral-small-latest",  { provider: "mistral", model: "mistral-small-latest",  inputPer1MTokens: 0.10, outputPer1MTokens: 0.30 }],
  ["mistral/codestral-latest",      { provider: "mistral", model: "codestral-latest",      inputPer1MTokens: 0.30, outputPer1MTokens: 0.90 }],
  ["mistral/mistral-nemo",          { provider: "mistral", model: "mistral-nemo",          inputPer1MTokens: 0.02, outputPer1MTokens: 0.04 }],

  // ── Cohere ──────────────────────────────────────────────────────────────
  ["cohere/command-a",       { provider: "cohere", model: "command-a",       inputPer1MTokens: 2.50,   outputPer1MTokens: 10.00 }],
  ["cohere/command-r-plus",  { provider: "cohere", model: "command-r-plus",  inputPer1MTokens: 2.50,   outputPer1MTokens: 10.00 }],
  ["cohere/command-r",       { provider: "cohere", model: "command-r",       inputPer1MTokens: 0.15,   outputPer1MTokens: 0.60  }],
  ["cohere/command-r7b",     { provider: "cohere", model: "command-r7b",     inputPer1MTokens: 0.0375, outputPer1MTokens: 0.15  }],

  // ── Groq ────────────────────────────────────────────────────────────────
  ["groq/llama-3.3-70b-versatile",   { provider: "groq", model: "llama-3.3-70b-versatile",   inputPer1MTokens: 0.59, outputPer1MTokens: 0.79 }],
  ["groq/llama-3.1-8b-instant",      { provider: "groq", model: "llama-3.1-8b-instant",      inputPer1MTokens: 0.05, outputPer1MTokens: 0.08 }],
  ["groq/llama-4-maverick-17bx128e", { provider: "groq", model: "llama-4-maverick-17bx128e", inputPer1MTokens: 0.20, outputPer1MTokens: 0.60 }],
  ["groq/mixtral-8x7b-32768",        { provider: "groq", model: "mixtral-8x7b-32768",        inputPer1MTokens: 0.24, outputPer1MTokens: 0.24 }],
];

/** Bundled pricing table keyed by "provider/model". */
export const BUNDLED_PRICES: Map<string, PriceEntry> = new Map(PRICES);

// ---------------------------------------------------------------------------
// Cost multipliers — ported from app's calculateEventCost()
// ---------------------------------------------------------------------------

const BATCH_API_MULTIPLIER = 0.5;
const FAST_MODE_MULTIPLIER = 6.0;

// OpenAI models with 75% cache read discount (0.25×); others get 50% (0.5×)
const OPENAI_DEEP_CACHE_PREFIXES = [
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "o3", "o3-mini", "o4-mini",
];

function cacheReadMultiplier(provider: string, model: string): number {
  if (provider === "openai") {
    const isDeep = OPENAI_DEEP_CACHE_PREFIXES.some(
      (prefix) => model === prefix || model.startsWith(prefix + "-")
    );
    return isDeep ? 0.25 : 0.5;
  }
  if (provider === "anthropic") return 0.1;
  if (provider === "google") return 0.1;
  if (provider === "groq") return 0.5;
  return 0.25; // conservative fallback
}

function cacheWriteMultiplier(provider: string, cacheTtl: string | undefined): number {
  if (provider === "anthropic") {
    return cacheTtl === "1h" ? 2.0 : 1.25; // 1h extended = 2.0×, default 5m = 1.25×
  }
  return 1.0;
}

// Google Flash models have flat pricing (no long-context surcharge)
const GOOGLE_FLASH_PREFIXES = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

function longContextMultiplier(provider: string, model: string, inputTokens: number): { input: number; output: number } | null {
  if (provider === "google") {
    const isFlash = GOOGLE_FLASH_PREFIXES.some((p) => model.startsWith(p));
    if (isFlash) return null;
    if (inputTokens > 200_000) {
      return { input: 2.0, output: 2.0 };
    }
  }
  return null;
}

// Web search flat fee per call (USD)
function webSearchFee(provider: string): number {
  if (provider === "openai") return 0.01;
  if (provider === "anthropic") return 0.01;
  if (provider === "google") return 0.014;
  if (provider === "groq") return 0.005;
  return 0;
}

// ---------------------------------------------------------------------------
// Public: estimateEventCost — synchronous, pure function
// ---------------------------------------------------------------------------

/**
 * Estimate the cost of a usage event using the bundled pricing table.
 * Returns `null` if the model is not found in pricing (and no `costUsd` override).
 * If `event.costUsd` is provided, returns that directly (user override).
 */
export function estimateEventCost(
  event: UsageEventInput,
  customPricing?: Map<string, PriceEntry>
): number | null {
  // User override takes precedence
  if (event.costUsd !== undefined && event.costUsd !== null) {
    return event.costUsd;
  }

  const provider = event.provider.trim().toLowerCase();
  const model = event.model.trim();
  const key = `${provider}/${model}`;

  const price = customPricing?.get(key) ?? BUNDLED_PRICES.get(key);
  if (!price) return null;

  const cached = event.inputTokensCached ?? 0;
  const cacheWrite = event.inputTokensCacheWrite ?? 0;
  const regularInput = Math.max(0, event.inputTokens - cached - cacheWrite);

  // Base token cost + cache adjustments
  let inputCost =
    (regularInput * price.inputPer1MTokens +
      cached * price.inputPer1MTokens * cacheReadMultiplier(provider, model) +
      cacheWrite * price.inputPer1MTokens * cacheWriteMultiplier(provider, event.cacheTtl)) /
    1_000_000;

  let outputCost = (event.outputTokens * price.outputPer1MTokens) / 1_000_000;

  // Long context premium (per-component, before summing)
  const longCtx = longContextMultiplier(provider, model, event.inputTokens);
  if (longCtx) {
    inputCost *= longCtx.input;
    outputCost *= longCtx.output;
  }

  let tokenCost = inputCost + outputCost;

  // Batch API — 50% discount on token costs
  if (event.isBatchApi) {
    tokenCost *= BATCH_API_MULTIPLIER;
  }

  // Fast mode — 6× multiplier on token costs
  if (event.isFastMode) {
    tokenCost *= FAST_MODE_MULTIPLIER;
  }

  // Flat fees for tool calls
  const webSearches = event.webSearchCount ?? 0;
  const webFetches = event.webFetchCount ?? 0;
  const toolCost = webSearches * webSearchFee(provider) + webFetches * 0; // web fetch is free

  return tokenCost + toolCost;
}

// ---------------------------------------------------------------------------
// API price cache — populated by refreshPricing(), checked by estimateCost()
// ---------------------------------------------------------------------------

let apiPriceCache: Map<string, PriceEntry> | null = null;
let apiPriceCacheTimestamp = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isCacheFresh(): boolean {
  return apiPriceCache !== null && Date.now() - apiPriceCacheTimestamp < CACHE_TTL_MS;
}

/**
 * Fetch live model pricing from the AISpendGuard API and cache locally.
 * Call once at startup or periodically — estimateCost() uses cached prices
 * automatically. Falls back silently to BUNDLED_PRICES if the fetch fails.
 *
 * @param endpoint - Base URL of the AISpendGuard app (default: https://www.aispendguard.com)
 */
export async function refreshPricing(
  endpoint = "https://www.aispendguard.com"
): Promise<{ models: number; source: "api" | "bundled" }> {
  try {
    const url = `${endpoint.replace(/\/+$/, "")}/api/public/model-prices`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "AISpendGuard-SDK" },
    });
    if (!res.ok) {
      return { models: BUNDLED_PRICES.size, source: "bundled" };
    }
    const json = (await res.json()) as {
      models?: Array<{
        provider: string;
        model: string;
        inputPricePer1M: number;
        outputPricePer1M: number;
      }>;
    };
    const cache = new Map<string, PriceEntry>();
    for (const m of json.models ?? []) {
      const key = `${m.provider.toLowerCase()}/${m.model}`;
      cache.set(key, {
        provider: m.provider,
        model: m.model,
        inputPer1MTokens: m.inputPricePer1M,
        outputPer1MTokens: m.outputPricePer1M,
      });
    }
    apiPriceCache = cache;
    apiPriceCacheTimestamp = Date.now();
    return { models: cache.size, source: "api" };
  } catch {
    return { models: BUNDLED_PRICES.size, source: "bundled" };
  }
}

// ---------------------------------------------------------------------------
// Public: estimateCost — simplified convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Estimate the cost of an AI API call before making it.
 *
 * Uses API-fetched prices (if refreshPricing() was called) with fallback
 * to bundled prices. Returns null if the model is not found in any source.
 *
 * @example
 * ```typescript
 * const estimate = estimateCost({
 *   provider: "openai",
 *   model: "gpt-4o",
 *   inputTokens: 1000,
 *   outputTokens: 500,
 * });
 * if (estimate && estimate.estimatedCostUsd > 0.10) {
 *   console.log("Consider a cheaper model");
 * }
 * ```
 */
export function estimateCost(
  params: CostEstimateInput,
  customPricing?: Map<string, PriceEntry>
): CostEstimate | null {
  const provider = params.provider.trim().toLowerCase();
  const model = params.model.trim();
  const key = `${provider}/${model}`;

  // Priority: customPricing > API cache > bundled
  const price =
    customPricing?.get(key) ??
    (isCacheFresh() ? apiPriceCache?.get(key) : undefined) ??
    BUNDLED_PRICES.get(key);
  if (!price) return null;

  // Delegate to estimateEventCost for accurate total (reuse all multiplier logic)
  const syntheticEvent: UsageEventInput = {
    provider: params.provider,
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    inputTokensCached: params.cachedTokens,
    inputTokensCacheWrite: params.cacheWriteTokens,
    cacheTtl: params.cacheTtl,
    isBatchApi: params.batchMode,
    isFastMode: params.fastMode,
    webSearchCount: params.webSearchCount,
    latencyMs: 0,
    timestamp: new Date().toISOString(),
    tags: { task_type: "_estimate", feature: "_estimate", route: "_estimate" },
  };

  const totalCost = estimateEventCost(syntheticEvent, customPricing);
  if (totalCost === null) return null;

  // Calculate component costs for the breakdown
  const cached = params.cachedTokens ?? 0;
  const cacheWrite = params.cacheWriteTokens ?? 0;
  const regularInput = Math.max(0, params.inputTokens - cached - cacheWrite);

  let inputCost =
    (regularInput * price.inputPer1MTokens +
      cached * price.inputPer1MTokens * cacheReadMultiplier(provider, model) +
      cacheWrite * price.inputPer1MTokens * cacheWriteMultiplier(provider, params.cacheTtl)) /
    1_000_000;

  let outputCost = (params.outputTokens * price.outputPer1MTokens) / 1_000_000;

  const longCtx = longContextMultiplier(provider, model, params.inputTokens);
  if (longCtx) {
    inputCost *= longCtx.input;
    outputCost *= longCtx.output;
  }

  if (params.batchMode) {
    inputCost *= BATCH_API_MULTIPLIER;
    outputCost *= BATCH_API_MULTIPLIER;
  }
  if (params.fastMode) {
    inputCost *= FAST_MODE_MULTIPLIER;
    outputCost *= FAST_MODE_MULTIPLIER;
  }

  const webSearches = params.webSearchCount ?? 0;
  const toolCost = webSearches * webSearchFee(provider);

  return {
    estimatedCostUsd: totalCost,
    inputCostUsd: inputCost,
    outputCostUsd: outputCost,
    toolCostUsd: toolCost,
    model: key,
    pricePerInputToken: price.inputPer1MTokens,
    pricePerOutputToken: price.outputPer1MTokens,
  };
}
