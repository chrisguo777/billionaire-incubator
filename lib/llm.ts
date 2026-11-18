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

/** Total attempts per step when the model's output fails the schema or a `check`. */
export const MAX_ATTEMPTS = 3;

/** The model's output failed the schema or a content rule on every attempt. */
export class StructuredOutputError extends Error {
  readonly attempts: number;
  constructor(message: string, attempts: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StructuredOutputError";
    this.attempts = attempts;
  }
}

/** The model declined the request (stop_reason "refusal"); retrying would not help. */
export class ModelRefusalError extends Error {
  constructor() {
    super("The model declined this request.");
    this.name = "ModelRefusalError";
  }
}

export interface CallOptions<T> {
  /**
   * Content rules that the schema cannot express. Throw when the output is
   * well-formed but breaks a rule; the step is then retried like a schema failure.
   */
  check?: (output: T) => void;
}

// SDK 0.135 throws AnthropicError("Failed to parse structured output…") when the
// response fails JSON parsing or the Zod schema (it does not send enum limits to the model).
function isSchemaFailure(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Failed to parse structured output");
}

export async function callStructured<S extends z.ZodType>(
  schema: S,
  system: string,
  user: string,
  effort: "low" | "medium" | "high" = "low",
  options: CallOptions<z.infer<S>> = {},
): Promise<z.infer<S>> {
  const provider = getProvider();
  if (provider === "mock") throw new Error("Mock 模式不调用真实模型。");
  if (!hasApiCredentials()) throw new Error("请先在项目根目录的 .env.local 中填写 ANTHROPIC_API_KEY，再重启开发服务。当前不会改用内置示例。");
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Network errors, 429 and 5xx are already retried by the SDK (maxRetries 2), so only output problems are retried here.
      const response = await getClient().messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort, format: zodOutputFormat(schema) },
      });
      if (response.stop_reason === "refusal") throw new ModelRefusalError();
      if (!response.parsed_output) {
        throw new StructuredOutputError("The model returned output that did not match the schema.", attempt);
      }
      const output = response.parsed_output as z.infer<S>;
      if (options.check) {
        try {
          options.check(output);
        } catch (err) {
          throw new StructuredOutputError(err instanceof Error ? err.message : String(err), attempt, { cause: err });
        }
      }
      return output;
    } catch (err) {
      if (!(err instanceof StructuredOutputError) && !isSchemaFailure(err)) throw err;
      lastError = err;
      console.error(`[callStructured] attempt ${attempt}/${MAX_ATTEMPTS} produced invalid output:`, err);
    }
  }
  throw new StructuredOutputError(
    `Model output was invalid ${MAX_ATTEMPTS} times in a row: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    MAX_ATTEMPTS,
    { cause: lastError },
  );
}
