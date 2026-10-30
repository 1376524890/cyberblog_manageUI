import { ApiError } from "../core/errors.ts";
import { readSettings, validateEndpoint, type AISettings } from "./settings.ts";
import {
  ensureBudget,
  recordUsage,
  normalizeUsage,
  standardUsage,
  type UsageKind,
} from "./usage.ts";
export type Message = {
  role: string;
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
};
export async function providerRequest(
  settings: AISettings,
  endpoint: string,
  payload?: unknown,
  signal?: AbortSignal,
) {
  const base = validateEndpoint(settings.baseUrl);
  try {
    const response = await fetch(`${base}/${endpoint}`, {
      method: payload ? "POST" : "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(settings.timeoutSeconds * 1000),
          ])
        : AbortSignal.timeout(settings.timeoutSeconds * 1000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      const code =
        status === 401 || status === 403
          ? "AI_AUTH_ERROR"
          : status === 404
            ? "AI_ENDPOINT_OR_MODEL"
            : status === 429
              ? "AI_PROVIDER_RATE_LIMIT"
              : status === 400 || status === 422
                ? "AI_PARAMETERS_UNSUPPORTED"
                : "AI_PROVIDER_ERROR";
      const hint =
        status === 401 || status === 403
          ? "密钥无效或没有访问权限"
          : status === 404
            ? "接口路径或模型不存在"
            : status === 429
              ? "服务商限流或账户额度不足"
              : status === 400 || status === 422
                ? "模型或请求参数不兼容，请检查温度、长度参数和工具模式"
                : "模型服务暂时不可用";
      throw new ApiError(502, code, `HTTP ${status}：${hint}`, {
        httpStatus: status,
      });
    }
    const raw = await response.text();
    if (raw.length > 2_000_000)
      throw new ApiError(502, "AI_RESPONSE_LIMIT", "模型响应过大，请缩短任务");
    try {
      return JSON.parse(
        settings.apiKey ? raw.split(settings.apiKey).join("[已隐藏]") : raw,
      );
    } catch {
      throw new ApiError(
        502,
        "AI_INVALID_RESPONSE",
        "接口没有返回合法 JSON，请检查是否填写了 API 地址",
      );
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(
      502,
      "AI_CONNECTION",
      "模型连接失败或超时，请检查服务地址和网络后重试",
    );
  }
}
export async function requireAI() {
  const settings = await readSettings();
  if (!settings.enabled || !settings.model || !settings.apiKey)
    throw new ApiError(
      409,
      "AI_NOT_CONFIGURED",
      "请先在「AI 设置」中配置接口、模型和密钥并启用 AI",
    );
  return settings;
}
export async function complete(
  s: AISettings,
  messages: Message[],
  tools?: unknown[],
  signal?: AbortSignal,
  kind: UsageKind = "edit",
) {
  await ensureBudget(s);
  const started = Date.now();
  let rawUsage: unknown = null;
  let ok = false;
  let errorCode: string | null = null;
  try {
    const result = await providerRequest(
      s,
      "chat/completions",
      {
        model: s.model,
        messages,
        stream: false,
        store: false,
        ...(s.temperature === null ? {} : { temperature: s.temperature }),
        [s.tokenParameter ?? "max_tokens"]: s.maxTokens,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      },
      signal,
    );
    rawUsage = result.usage ?? null;
    const choice = result.choices?.[0];
    const message = choice?.message;
    if (!message || (!message.content && !message.tool_calls?.length))
      throw new ApiError(
        502,
        "AI_EMPTY",
        "模型未返回可用内容，请调整模型或请求",
      );
    if (choice.finish_reason === "length")
      throw new ApiError(
        422,
        "AI_TRUNCATED",
        "模型输出达到长度限制，未应用截断结果；请提高输出上限或缩短任务",
      );
    ok = true;
    return {
      message: message as Message,
      usage: standardUsage(normalizeUsage(result.usage)),
    };
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : "AI_REQUEST_FAILED";
    if (e instanceof ApiError)
      throw new ApiError(e.status, e.code, e.message, {
        ...((e.details as Record<string, unknown>) ?? {}),
        attempted: true,
        usage: standardUsage(normalizeUsage(rawUsage)),
      });
    throw e;
  } finally {
    await recordUsage({
      ...normalizeUsage(rawUsage),
      model: s.model,
      provider: new URL(s.baseUrl).origin,
      kind,
      ok,
      durationMs: Date.now() - started,
      errorCode,
    }).catch(() => {
      console.error("[cms:ai-usage] usage record could not be saved");
    });
  }
}
export function parseJSON(text: string) {
  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(
      502,
      "AI_FORMAT",
      "模型没有返回预期的数据格式，请重试或更换模型",
    );
  }
}
