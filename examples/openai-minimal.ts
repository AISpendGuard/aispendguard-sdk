import { init, trackUsage, createOpenAIUsageEvent } from "../src";

async function run() {
  init({
    apiKey: process.env.AISPENDGUARD_API_KEY || "asg_replace_me",
    endpoint: process.env.AISPENDGUARD_ENDPOINT || "https://www.aispendguard.com/api/ingest",
  });

  const event = createOpenAIUsageEvent({
    model: "gpt-4o-mini",
    usage: {
      input_tokens: 120,
      output_tokens: 12
    },
    latencyMs: 840,
    tags: {
      task_type: "classify",
      feature: "lead_classifier",
      route: "POST /api/ai/classify",
      environment: "dev"
    }
  });

  const result = await trackUsage(event);
  console.log(result);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
