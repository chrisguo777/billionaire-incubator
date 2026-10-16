import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export type Mode = "live" | "mock";

export function getMode(): Mode {
  if (process.env.LLM_MODE === "mock") return "mock";
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "live";
  return "mock";
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function callStructured<S extends z.ZodType>(
  schema: S,
  system: string,
  user: string,
  effort: "low" | "medium" | "high" = "low",
): Promise<z.infer<S>> {
  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request.");
  }
  if (!response.parsed_output) {
    throw new Error("The model returned output that did not match the schema.");
  }
  return response.parsed_output as z.infer<S>;
}
