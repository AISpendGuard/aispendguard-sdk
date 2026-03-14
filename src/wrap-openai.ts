import type { UsageTags } from "./types";
import { createOpenAIUsageEvent } from "./openai";
import { getClient } from "./index";

type AsgOptions = { asgTags?: UsageTags };

/**
 * Wraps an OpenAI client so every chat.completions.create() call is
 * automatically tracked. Returns the original response unchanged.
 *
 * Usage:
 *   import { init, wrapOpenAI } from "@aispendguard/sdk";
 *   import OpenAI from "openai";
 *
 *   init({ apiKey: "asg_...", defaultTags: { feature: "chat", route: "/api/chat" } });
 *   const openai = wrapOpenAI(new OpenAI());
 *
 *   // Automatically tracked:
 *   const res = await openai.chat.completions.create({ model: "gpt-4o", messages: [...] });
 */
export function wrapOpenAI<T extends object>(client: T): T {
  const chat = (client as Record<string, unknown>).chat;
  if (!chat || typeof chat !== "object") return client;

  const completions = (chat as Record<string, unknown>).completions;
  if (!completions || typeof completions !== "object") return client;

  const originalCreate = (completions as Record<string, unknown>).create;
  if (typeof originalCreate !== "function") return client;

  (completions as Record<string, unknown>).create = async function wrappedCreate(
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

      const event = createOpenAIUsageEvent({
        model,
        resolvedModel,
        usage: usage as Parameters<typeof createOpenAIUsageEvent>[0]["usage"],
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
