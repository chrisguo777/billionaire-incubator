import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export type Mode = "live" | "mock";
export type Provider = "anthropic" | "mock";

export function getProvider(): Provider {
  if (process.env.LLM_MODE === "mock") return "mock";
  const provider = process.env.LLM_PROVIDER;
  if (provider && provider !== "anthropic") throw new Error("LLM_PROVIDER 只能是 anthropic；如需内置示例，请设置 LLM_MODE=mock。");
  if (provider === "anthropic" || hasApiCredentials()) return "anthropic";
  return "mock";
}

function hasApiCredentials(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export function isProviderConfigured(): boolean {
  return getProvider() !== "anthropic" || hasApiCredentials();
}

export function getMode(): Mode {
  return getProvider() === "mock" ? "mock" : "live";
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
  const provider = getProvider();
  if (provider === "mock") throw new Error("Mock 模式不调用真实模型。");
  if (!hasApiCredentials()) throw new Error("请先在项目根目录的 .env.local 中填写 ANTHROPIC_API_KEY，再重启开发服务。当前不会改用内置示例。");
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
