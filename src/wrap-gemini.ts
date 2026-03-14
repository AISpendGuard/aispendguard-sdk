import type { UsageTags } from "./types";
import { createGeminiUsageEvent } from "./gemini";
import { getClient } from "./index";

type AsgOptions = { asgTags?: UsageTags };

/**
 * Wraps a Google Gemini GenerativeModel so every generateContent() call is
 * automatically tracked. Returns the original response unchanged.
 *
 * Usage:
 *   import { init, wrapGemini } from "@aispendguard/sdk";
 *   import { GoogleGenerativeAI } from "@google/generative-ai";
 *
 *   init({ apiKey: "asg_...", defaultTags: { feature: "chat", route: "/api/chat" } });
 *   const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
 *   const model = wrapGemini(genAI.getGenerativeModel({ model: "gemini-2.0-flash" }), "gemini-2.0-flash");
 *
 *   // Automatically tracked:
 *   const result = await model.generateContent("Hello");
 */
export function wrapGemini<T extends object>(client: T, modelName: string): T {
  const originalGenerate = (client as Record<string, unknown>).generateContent;
  if (typeof originalGenerate !== "function") return client;

  (client as Record<string, unknown>).generateContent = async function wrappedGenerate(
    this: unknown,
    ...args: unknown[]
  ) {
    const start = Date.now();
    const result = await originalGenerate.apply(this, args);
    const latencyMs = Date.now() - start;

    try {
      const client = getClientSafe();
      if (!client) return result;

      const res = result as Record<string, unknown>;
      const response = res.response as Record<string, unknown> | undefined;
      const usage = (response?.usageMetadata ?? res.usageMetadata) as Record<string, unknown> | undefined;
      const resolvedModel = typeof (response as Record<string, unknown>)?.modelVersion === "string"
        ? (response as Record<string, unknown>).modelVersion as string
        : undefined;

      // Check for asgTags in the first argument if it's an object
      let asgTags: UsageTags | undefined;
      if (args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
        asgTags = (args[0] as AsgOptions).asgTags;
      }

      const tags = mergeTags(client.defaultTags, asgTags, modelName);

      const event = createGeminiUsageEvent({
        model: modelName,
        resolvedModel,
        usage: usage as Parameters<typeof createGeminiUsageEvent>[0]["usage"],
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
