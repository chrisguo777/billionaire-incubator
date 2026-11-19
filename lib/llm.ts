import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";

// Two ways to reach a model, behind one function (callStructured):
// - "anthropic": Claude through the official Anthropic SDK (the default).
// - "openai-compatible": any provider with an OpenAI-style Chat Completions API
//   (OpenAI, DeepSeek, Doubao / Volcengine Ark, Gemini, Qwen, Kimi, OpenRouter...),
//   configured with LLM_BASE_URL, LLM_API_KEY and LLM_MODEL.
// The prompts were tuned on Claude; other models work but are not evaluated.

export type Mode = "live" | "mock";
export type Provider = "anthropic" | "openai-compatible" | "mock";
const LIVE_PROVIDERS = ["anthropic", "openai-compatible"] as const;

const env = (name: string) => process.env[name]?.trim() || "";

export function getProvider(): Provider {
  if (process.env.LLM_MODE === "mock") return "mock";
  const provider = env("LLM_PROVIDER");
  if (provider) {
    if (!(LIVE_PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error("LLM_PROVIDER 只能是 anthropic 或 openai-compatible；如需内置示例，请设置 LLM_MODE=mock。");
    }
    return provider as Provider;
  }
  return hasApiCredentials("anthropic") ? "anthropic" : "mock";
}

function hasApiCredentials(provider: Provider): boolean {
  if (provider === "anthropic") return !!(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN"));
  if (provider === "openai-compatible") return !!(env("LLM_BASE_URL") && env("LLM_API_KEY") && env("LLM_MODEL"));
  return true;
}

export function isProviderConfigured(): boolean {
  return hasApiCredentials(getProvider());
}

export function getMode(): Mode {
  return getProvider() === "mock" ? "mock" : "live";
}

const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** The model a live call would use, for display. Null in mock mode. */
export function getModelName(): string | null {
  const provider = getProvider();
  if (provider === "anthropic") return env("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL;
  if (provider === "openai-compatible") return env("LLM_MODEL") || null;
  return null;
}

function missingConfigMessage(provider: Provider): string {
  return provider === "openai-compatible"
    ? "请先在项目根目录的 .env.local 中填写 LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL，再重启开发服务。当前不会改用内置示例。"
    : "请先在项目根目录的 .env.local 中填写 ANTHROPIC_API_KEY，再重启开发服务。当前不会改用内置示例。";
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

/** The model declined the request; retrying would not help. */
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

type Effort = "low" | "medium" | "high";

// ---------- Anthropic ----------

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

// SDK 0.135 throws AnthropicError("Failed to parse structured output…") when the
// response fails JSON parsing or the Zod schema (it does not send enum limits to the model).
function isSchemaFailure(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Failed to parse structured output");
}

async function askAnthropic<S extends z.ZodType>(schema: S, system: string, user: string, effort: Effort, attempt: number): Promise<z.infer<S>> {
  // Network errors, 429 and 5xx are already retried by the SDK (maxRetries 2), so only output problems are retried here.
  const response = await getAnthropicClient().messages.parse({
    model: env("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === "refusal") throw new ModelRefusalError();
  if (!response.parsed_output) {
    throw new StructuredOutputError("The model returned output that did not match the schema.", attempt);
  }
  return response.parsed_output as z.infer<S>;
}

// ---------- OpenAI-compatible ----------

let openAIClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openAIClient) openAIClient = new OpenAI({ apiKey: env("LLM_API_KEY"), baseURL: env("LLM_BASE_URL") });
  return openAIClient;
}

/** Zod schema → plain JSON Schema (all fields required, no extra properties), as strict modes expect. */
export function toJSONSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

// "json_schema" (default): the provider enforces the schema. "json_object": the provider only
// guarantees valid JSON and the schema goes into the prompt. A provider that rejects json_schema
// with a 400 is switched to json_object for the rest of the process.
let jsonSchemaRejected = false;
function jsonMode(): "json_schema" | "json_object" {
  return env("LLM_JSON_MODE") === "json_object" || jsonSchemaRejected ? "json_object" : "json_schema";
}

function isOfficialOpenAI(): boolean {
  try { return new URL(env("LLM_BASE_URL")).hostname === "api.openai.com"; } catch { return false; }
}

function tokenLimit(): Record<string, number> {
  const limit = Number(env("LLM_MAX_TOKENS")) || (isOfficialOpenAI() ? 16000 : 8192);
  // Newer OpenAI models take max_completion_tokens; most other providers still take max_tokens.
  const param = env("LLM_MAX_TOKENS_PARAM") || (isOfficialOpenAI() ? "max_completion_tokens" : "max_tokens");
  return { [param]: limit };
}

/** Pulls the JSON object out of a reply, tolerating a ```json fence around it. */
export function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

async function askOpenAICompatible<S extends z.ZodType>(schema: S, system: string, user: string, attempt: number): Promise<z.infer<S>> {
  const jsonSchema = toJSONSchema(schema);
  const request = (mode: "json_schema" | "json_object") => getOpenAIClient().chat.completions.create({
    model: env("LLM_MODEL"),
    messages: [
      {
        role: "system",
        content: mode === "json_schema"
          ? system
          : `${system}\n\nReply with a single JSON object only, no other text. It must match this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`,
      },
      { role: "user", content: user },
    ],
    response_format: mode === "json_schema"
      ? { type: "json_schema", json_schema: { name: "structured_output", schema: jsonSchema, strict: true } }
      : { type: "json_object" },
    ...tokenLimit(),
    ...(env("LLM_REASONING_EFFORT") ? { reasoning_effort: env("LLM_REASONING_EFFORT") as OpenAI.ReasoningEffort } : {}),
  });

  let completion: OpenAI.Chat.Completions.ChatCompletion;
  const mode = jsonMode();
  try {
    completion = await request(mode);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (mode !== "json_schema" || status !== 400) throw err;
    console.error("[callStructured] the provider rejected json_schema; switching to json_object mode:", err);
    jsonSchemaRejected = true;
    completion = await request("json_object");
  }

  const choice = completion.choices[0];
  if (!choice) throw new StructuredOutputError("The provider returned no choices.", attempt);
  if (choice.message.refusal || choice.finish_reason === "content_filter") throw new ModelRefusalError();
  if (choice.finish_reason === "length") {
    throw new StructuredOutputError("The output hit the token limit before it finished (raise LLM_MAX_TOKENS).", attempt);
  }
  let json: unknown;
  try {
    json = extractJSON(choice.message.content ?? "");
  } catch (err) {
    throw new StructuredOutputError("The model returned output that is not valid JSON.", attempt, { cause: err });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new StructuredOutputError(`The model returned output that did not match the schema: ${parsed.error.message}`, attempt, { cause: parsed.error });
  }
  return parsed.data as z.infer<S>;
}

// ---------- The one entry point ----------

export async function callStructured<S extends z.ZodType>(
  schema: S,
  system: string,
  user: string,
  effort: Effort = "low",
  options: CallOptions<z.infer<S>> = {},
): Promise<z.infer<S>> {
  const provider = getProvider();
  if (provider === "mock") throw new Error("Mock 模式不调用真实模型。");
  if (!hasApiCredentials(provider)) throw new Error(missingConfigMessage(provider));
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const output = provider === "anthropic"
        ? await askAnthropic(schema, system, user, effort, attempt)
        : await askOpenAICompatible(schema, system, user, attempt);
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
