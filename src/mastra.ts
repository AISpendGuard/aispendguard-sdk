/**
 * AISpendGuard integration for Mastra agent framework.
 *
 * Configures Mastra's built-in OpenTelemetry telemetry to export
 * AI usage traces to AISpendGuard's OTLP endpoint.
 *
 * Usage:
 *   import { Mastra } from "@mastra/core";
 *   import { createMastraExporter } from "@aispendguard/sdk/mastra";
 *
 *   const mastra = new Mastra({
 *     telemetry: createMastraExporter({ apiKey: "asg_..." }),
 *     agents: { ... },
 *   });
 */

const DEFAULT_OTLP_ENDPOINT = "https://www.aispendguard.com/api/ingest/otlp";

export type MastraExporterConfig = {
  /** AISpendGuard API key (starts with "asg_") */
  apiKey: string;
  /** OTLP endpoint. Default: https://www.aispendguard.com/api/ingest/otlp */
  endpoint?: string;
  /** Default tags applied to all events. Must include task_type, feature, route. */
  defaultTags?: Record<string, string>;
  /** Service name for OTEL resource. Default: "mastra-app" */
  serviceName?: string;
};

/**
 * Creates a Mastra-compatible telemetry configuration that exports
 * AI usage traces to AISpendGuard via OTLP/HTTP.
 *
 * The returned object is passed directly to `new Mastra({ telemetry: ... })`.
 */
export function createMastraExporter(config: MastraExporterConfig) {
  if (!config.apiKey || !config.apiKey.startsWith("asg_")) {
    throw new Error(
      "AISpendGuard: apiKey is required and must start with 'asg_'. " +
      "Get your key at https://aispendguard.com/settings/api-keys"
    );
  }

  const endpoint = config.endpoint ?? DEFAULT_OTLP_ENDPOINT;
  const serviceName = config.serviceName ?? "mastra-app";

  // Build resource attributes for default tags.
  // Mastra passes these as OTEL resource attributes → our OTLP mapper
  // reads aispendguard.tag.* attributes and maps them to event tags.
  const resourceAttributes: Record<string, string> = {};
  if (config.defaultTags) {
    for (const [key, value] of Object.entries(config.defaultTags)) {
      resourceAttributes[`aispendguard.tag.${key}`] = value;
    }
  }
  // Ensure source tag is always set
  if (!resourceAttributes["aispendguard.tag.source"]) {
    resourceAttributes["aispendguard.tag.source"] = "mastra";
  }

  return {
    serviceName,
    enabled: true,
    export: {
      type: "otlp" as const,
      endpoint,
      headers: {
        "x-api-key": config.apiKey,
      },
    },
    resource: {
      attributes: resourceAttributes,
    },
  };
}
