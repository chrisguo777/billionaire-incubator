import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk/error";
import * as OpenAIErrors from "openai/error";
import { MAX_ATTEMPTS, ModelRefusalError, StructuredOutputError } from "./llm";
import { InvalidCardSelectionError } from "./resume-selection";

export interface UserFacingError {
  status: number;
  message: string;
}

const hasChinese = (text: string) => /[一-鿿]/.test(text);

/**
 * Turns any error thrown inside a step into a Chinese message for the page.
 * Messages the project writes itself (already Chinese) pass through unchanged;
 * SDK and provider errors, which are English, are replaced.
 */
export function toUserFacingError(err: unknown): UserFacingError {
  if (err instanceof InvalidCardSelectionError) return { status: 400, message: err.message };
  if (err instanceof StructuredOutputError) {
    // A content check written by the project can say what went wrong; schema errors are English and only logged.
    const cause = err.cause instanceof StructuredOutputError ? err.cause.cause : err.cause;
    const detail = cause instanceof Error && hasChinese(cause.message) ? `（最后一次的问题：${cause.message}）` : "";
    return { status: 502, message: `AI 这一步的输出连续 ${MAX_ATTEMPTS} 次不合格，请再点一次按钮；已完成的步骤不会丢失。${detail}` };
  }
  if (err instanceof ModelRefusalError) return { status: 502, message: "模型拒绝处理这次请求，请检查简历和 JD 的内容后再试。" };
  // The Anthropic and OpenAI SDKs share the same error hierarchy; both are mapped the same way.
  const O = OpenAIErrors;
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError || err instanceof O.AuthenticationError || err instanceof O.PermissionDeniedError) {
    return { status: 502, message: "API key 无效或没有权限，请检查 .env.local 后重启开发服务。" };
  }
  if (err instanceof O.NotFoundError) {
    return { status: 502, message: "模型服务找不到这个模型或地址，请检查 .env.local 里的 LLM_BASE_URL 和 LLM_MODEL。" };
  }
  // InternalServerError covers every 5xx, including 529 overloaded. The SDK has already retried these twice.
  if (err instanceof RateLimitError || err instanceof InternalServerError || err instanceof O.RateLimitError || err instanceof O.InternalServerError) {
    return { status: 503, message: "模型服务繁忙，请稍后再试；已完成的步骤不会丢失。" };
  }
  if (err instanceof APIConnectionError || err instanceof O.APIConnectionError) {
    return { status: 503, message: "连接模型服务失败或超时，请检查网络后再试；已完成的步骤不会丢失。" };
  }
  if (err instanceof BadRequestError || err instanceof O.BadRequestError) {
    return { status: 502, message: "模型服务拒绝了这次请求（输入可能过长或格式不对），请检查简历和 JD 后再试。" };
  }
  if (err instanceof APIError || err instanceof O.APIError) return { status: 502, message: "模型服务返回了错误，请稍后再试；已完成的步骤不会丢失。" };
  if (err instanceof Error && hasChinese(err.message)) return { status: 500, message: err.message };
  return { status: 500, message: "服务器处理这一步时出错，请再试一次；已完成的步骤不会丢失。" };
}
