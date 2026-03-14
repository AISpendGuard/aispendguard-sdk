import type { UsageTags } from "./types";
import { createAnthropicUsageEvent } from "./anthropic";
import { getClient } from "./index";

type AsgOptions = { asgTags?: UsageTags };

/**
 * Wraps an Anthropic client so every messages.create() call is
 * automatically tracked. Returns the original response unchanged.
 *
 * Usage:
 *   import { init, wrapAnthropic } from "@aispendguard/sdk";
 *   import Anthropic from "@anthropic-ai/sdk";
 *
 *   init({ apiKey: "asg_...", defaultTags: { feature: "chat", route: "/api/chat" } });
 *   const anthropic = wrapAnthropic(new Anthropic());
 *
 *   // Automatically tracked:
 *   const msg = await anthropic.messages.create({ model: "claude-sonnet-4-20250514", ... });
 */
export function wrapAnthropic<T extends object>(client: T): T {
  const messages = (client as Record<string, unknown>).messages;
  if (!messages || typeof messages !== "object") return client;

  const originalCreate = (messages as Record<string, unknown>).create;
  if (typeof originalCreate !== "function") return client;

  (messages as Record<string, unknown>).create = async function wrappedCreate(
    this: unknown,
    params: Record<string, unknown>,
    ...rest: unknown[]
  ) {
    const start = Date.now();
    const result = await originalCreate.call(this, params, ...rest);
    const latencyMs = Date.now() - start;

    try {
      const client = getClientSafe();
      if (!client) return result;

      const res = result as Record<string, unknown>;
      const model = (params.model as string) ?? "unknown";
      const resolvedModel = typeof res.model === "string" ? res.model : undefined;
      const usage = res.usage as Record<string, unknown> | undefined;
      const asgOpts = params as AsgOptions;

      const tags = mergeTags(client.defaultTags, asgOpts.asgTags, model);

      const event = createAnthropicUsageEvent({
        model,
        resolvedModel,
        usage: usage as Parameters<typeof createAnthropicUsageEvent>[0]["usage"],
        latencyMs,
        tags,
      });

      client.trackUsage(event).catch(logError);
    } catch {
      // Never break user code
    }

    return result;
  };

  return client;
}

function mergeTags(
  defaults: UsageTags | undefined,
  overrides: UsageTags | undefined,
  model: string
): UsageTags {
  return {
    task_type: "chat",
    feature: "default",
    route: "default",
    ...defaults,
    ...overrides,
    source: "auto-wrap",
    model,
  };
}

function getClientSafe() {
  try {
    return getClient();
  } catch {
    return null;
  }
}

function logError(err: unknown) {
  console.warn(
    `[aispendguard-sdk] auto-wrap tracking failed: ${err instanceof Error ? err.message : String(err)}`
  );
}
