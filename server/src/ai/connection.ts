import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../core/errors.ts";
import {
  readSettings,
  settingsPath,
  validateEndpoint,
  type AISettings,
} from "./settings.ts";
import { providerRequest, complete } from "./provider.ts";
import { aggregateUsages } from "./usage.ts";
const safeText = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !/[\r\n"\\]/.test(v), "连接参数不能包含换行、双引号或反斜线");
export async function connectionSettings(input: unknown): Promise<AISettings> {
  const q = z
    .object({
      baseUrl: safeText.optional(),
      apiKey: safeText.optional(),
      model: safeText.optional(),
      mode: z.enum(["tools", "json"]).optional(),
      temperature: z.number().min(0).max(2).nullable().optional(),
      tokenParameter: z
        .enum(["max_tokens", "max_completion_tokens"])
        .optional(),
      maxTokens: z.number().int().min(256).max(16384).optional(),
      timeoutSeconds: z.number().int().min(10).max(180).optional(),
    })
    .strict()
    .safeParse(input);
  if (!q.success)
    throw new ApiError(422, "AI_CONNECTION_INPUT", "连接参数格式不正确");
  const old = await readSettings(),
    baseUrl = validateEndpoint(q.data.baseUrl ?? old.baseUrl);
  if (
    baseUrl !== validateEndpoint(old.baseUrl) &&
    !q.data.apiKey?.trim() &&
    old.apiKey
  )
    throw new ApiError(
      422,
      "AI_KEY_REENTRY",
      "接口地址已变更，请重新输入该服务的密钥",
    );
  const s = {
    ...old,
    ...q.data,
    baseUrl,
    apiKey: q.data.apiKey?.trim() || old.apiKey,
    model: q.data.model ?? old.model,
  };
  if (!s.apiKey)
    throw new ApiError(
      409,
      "AI_NOT_CONFIGURED",
      "请填写接口地址和密钥后获取模型或测试连接",
    );
  return s;
}
const signature = (s: AISettings) =>
  createHash("sha256")
    .update(s.baseUrl + "|" + s.apiKey)
    .digest("hex");
const cache = new Map<
  string,
  { items: string[]; fetchedAt: string; durationMs: number }
>();
export async function discoverModels(s: AISettings, force = false) {
  const key = signature(s),
    cached = cache.get(key);
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < 600000)
    return { ...cached, cached: true, count: cached.items.length };
  const start = Date.now(),
    result = await providerRequest(s, "models");
  const list = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.models)
      ? result.models
      : null;
  if (!list)
    throw new ApiError(
      502,
      "AI_MODELS_FORMAT",
      "模型列表格式不兼容，可手动填写模型 ID 后测试生成",
    );
  const items = [
    ...new Set<string>(
      list
        .map((m: any) =>
          typeof m === "string" ? m : (m?.id ?? m?.name ?? m?.model),
        )
        .filter(
          (m: unknown) =>
            typeof m === "string" && m.length > 0 && m.length <= 300,
        ),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 500);
  const entry = {
    items,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
  cache.clear();
  cache.set(key, entry);
  return { ...entry, cached: false, count: items.length };
}
interface Check {
  name: string;
  status: "pass" | "fail" | "warning" | "skip";
  durationMs: number;
  detail: string;
  code?: string;
  httpStatus?: number;
}
const lastPath = path.join(
  path.dirname(settingsPath),
  ".runtime/ai-diagnostics.json",
);
const diagnosticsSignature = (s: AISettings) =>
  createHash("sha256")
    .update(
      signature(s) +
        "|" +
        s.model +
        "|" +
        s.mode +
        "|" +
        s.tokenParameter +
        "|" +
        s.temperature +
        "|" +
        s.maxTokens +
        "|" +
        s.timeoutSeconds,
    )
    .digest("hex");
export async function lastDiagnostics() {
  const s = await readSettings();
  try {
    const value = JSON.parse(await fs.readFile(lastPath, "utf8"));
    return value.signature === diagnosticsSignature(s) ? value.result : null;
  } catch (e: any) {
    if (e.code === "ENOENT" || e instanceof SyntaxError) return null;
    throw new ApiError(503, "AI_DIAGNOSTIC_READ", "暂时无法读取上次连接测试");
  }
}
export async function diagnose(s: AISettings, includeTools = false) {
  if (!s.model)
    throw new ApiError(422, "AI_MODEL_REQUIRED", "请先选择或填写模型 ID");
  const checks: Check[] = [
    {
      name: "配置与传输",
      status: "pass",
      durationMs: 0,
      detail: "接口地址和密钥已就绪，密钥仅由后端发送",
    },
  ];
  const usages: unknown[] = [];
  const started = Date.now();
  let generated = false,
    reply = "";
  async function step(
    name: string,
    fn: () => Promise<string>,
    optional = false,
  ) {
    const start = Date.now();
    try {
      checks.push({
        name,
        status: "pass",
        durationMs: Date.now() - start,
        detail: await fn(),
      });
      checks.at(-1)!.durationMs = Date.now() - start;
    } catch (e) {
      if (e instanceof ApiError && (e.details as any)?.attempted)
        usages.push((e.details as any).usage ?? null);
      checks.push({
        name,
        status: optional ? "warning" : "fail",
        durationMs: Date.now() - start,
        detail: e instanceof ApiError ? e.message : "连接测试失败",
        code: e instanceof ApiError ? e.code : "AI_CONNECTION",
        httpStatus:
          e instanceof ApiError ? (e.details as any)?.httpStatus : undefined,
      });
    }
  }
  await step(
    "模型列表与认证",
    async () => {
      const list = await discoverModels(s, true);
      return list.items.includes(s.model)
        ? `读取到 ${list.count} 个模型，包含当前模型`
        : `读取到 ${list.count} 个模型；当前 ID 未出现在列表中，将继续验证实际生成`;
    },
    true,
  );
  await step("实际文本生成", async () => {
    const r = await complete(
      s,
      [{ role: "user", content: "这是连接测试。请只回复 OK，不需要解释。" }],
      undefined,
      undefined,
      "test",
    );
    usages.push(r.usage);
    reply = r.message.content?.slice(0, 160) ?? "";
    if (!reply.trim())
      throw new ApiError(
        502,
        "AI_EMPTY_TEST",
        "接口未返回文本，无法确认生成可用",
      );
    generated = true;
    return reply ? `模型返回了文本：${reply}` : "接口成功返回，但没有文本内容";
  });
  if (includeTools && generated) {
    const tool = {
      type: "function",
      function: {
        name: "cms_connection_check",
        description: "确认工具调用可用，仅用于测试，不修改任何内容",
        parameters: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    };
    await step(
      "工具调用兼容",
      async () => {
        const r = await complete(
          s,
          [
            {
              role: "user",
              content:
                "请调用 cms_connection_check 函数，参数 ok 为 true。这是兼容性测试，不要执行其他操作。",
            },
          ],
          [tool],
          undefined,
          "test",
        );
        usages.push(r.usage);
        if (
          !r.message.tool_calls?.some(
            (c: any) => c.function?.name === "cms_connection_check",
          )
        ) {
          throw new ApiError(
            422,
            "AI_TOOL_UNCONFIRMED",
            "本次模型没有调用测试工具，无法确认原生工具能力；可选择 JSON 指令模式",
          );
        }
        return "模型已返回工具调用；测试没有执行任何写入";
      },
      true,
    );
  } else
    checks.push({
      name: "工具调用兼容",
      status: "skip",
      durationMs: 0,
      detail: includeTools ? "生成失败后跳过" : "本次未勾选工具调用测试",
    });
  const result = {
    ok: generated,
    model: s.model,
    testedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    checks,
    usage: aggregateUsages(usages),
    message: reply,
  };
  await fs.mkdir(path.dirname(lastPath), { recursive: true, mode: 0o700 });
  const temp = lastPath + ".tmp-" + crypto.randomUUID();
  await fs.writeFile(
    temp,
    JSON.stringify({ signature: diagnosticsSignature(s), result }),
    { mode: 0o600 },
  );
  await fs.rename(temp, lastPath);
  return result;
}
