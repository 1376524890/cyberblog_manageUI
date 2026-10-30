import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import { ApiError } from "../core/errors.ts";

export const settingsPath = path.resolve(
  process.env.CMS_AI_ENV_FILE ?? path.join(import.meta.dirname, "../../.env"),
);
const text = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !/[\r\n"\\]/.test(v), "不允许换行、双引号或反斜线");
const schema = z.object({
  dailyTokenLimit: z.number().int().min(0).max(1_000_000_000).default(0),
  monthlyTokenLimit: z.number().int().min(0).max(10_000_000_000).default(0),
  usageWarnPercent: z.number().int().min(10).max(100).default(80),
  enforceBudget: z.boolean().default(false),
  enabled: z.boolean(),
  baseUrl: text,
  model: text,
  apiKey: text.optional(),
  clearKey: z.boolean().optional(),
  mode: z.enum(["tools", "json"]).default("tools"),
  temperature: z.number().min(0).max(2).nullable().default(0.6),
  tokenParameter: z
    .enum(["max_tokens", "max_completion_tokens"])
    .default("max_tokens"),
  maxTokens: z.number().int().min(256).max(16384).default(4096),
  timeoutSeconds: z.number().int().min(10).max(180).default(90),
  systemPrompt: z.string().max(6000).default(""),
});
export type AISettings = Omit<z.infer<typeof schema>, "clearKey"> & {
  apiKey: string;
};
const keys = [
  "CMS_AI_ENABLED",
  "CMS_AI_BASE_URL",
  "CMS_AI_MODEL",
  "CMS_AI_API_KEY",
  "CMS_AI_MODE",
  "CMS_AI_TEMPERATURE",
  "CMS_AI_MAX_TOKENS",
  "CMS_AI_TIMEOUT_SECONDS",
  "CMS_AI_SYSTEM_PROMPT",
  "CMS_AI_TOKEN_PARAMETER",
  "CMS_AI_DAILY_TOKEN_LIMIT",
  "CMS_AI_MONTHLY_TOKEN_LIMIT",
  "CMS_AI_USAGE_WARN_PERCENT",
  "CMS_AI_ENFORCE_BUDGET",
];
export async function readSettings(): Promise<AISettings> {
  let env: Record<string, string | undefined> = {};
  try {
    env = parseEnv(await fs.readFile(settingsPath, "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT")
      throw new ApiError(500, "AI_CONFIG_READ", "AI 配置读取失败");
  }
  const prompt = env.CMS_AI_SYSTEM_PROMPT
    ? Buffer.from(env.CMS_AI_SYSTEM_PROMPT, "base64").toString("utf8")
    : "";
  return {
    enabled: env.CMS_AI_ENABLED === "true",
    dailyTokenLimit: Number(env.CMS_AI_DAILY_TOKEN_LIMIT ?? 0),
    monthlyTokenLimit: Number(env.CMS_AI_MONTHLY_TOKEN_LIMIT ?? 0),
    usageWarnPercent: Number(env.CMS_AI_USAGE_WARN_PERCENT ?? 80),
    enforceBudget: env.CMS_AI_ENFORCE_BUDGET === "true",
    baseUrl: env.CMS_AI_BASE_URL ?? "https://api.openai.com/v1",
    model: env.CMS_AI_MODEL ?? "",
    apiKey: env.CMS_AI_API_KEY ?? "",
    mode: env.CMS_AI_MODE === "json" ? "json" : "tools",
    temperature:
      env.CMS_AI_TEMPERATURE === "auto"
        ? null
        : Number(env.CMS_AI_TEMPERATURE ?? 0.6),
    tokenParameter:
      env.CMS_AI_TOKEN_PARAMETER === "max_completion_tokens"
        ? "max_completion_tokens"
        : "max_tokens",
    maxTokens: Number(env.CMS_AI_MAX_TOKENS ?? 4096),
    timeoutSeconds: Number(env.CMS_AI_TIMEOUT_SECONDS ?? 90),
    systemPrompt: prompt,
  };
}
export function publicSettings(s: AISettings) {
  return {
    enabled: s.enabled,
    dailyTokenLimit: s.dailyTokenLimit,
    monthlyTokenLimit: s.monthlyTokenLimit,
    usageWarnPercent: s.usageWarnPercent,
    enforceBudget: s.enforceBudget,
    baseUrl: s.baseUrl,
    model: s.model,
    mode: s.mode,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    timeoutSeconds: s.timeoutSeconds,
    systemPrompt: s.systemPrompt,
    tokenParameter: s.tokenParameter,
    hasKey: !!s.apiKey,
  };
}

export function validateEndpoint(base: string) {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new ApiError(422, "AI_ENDPOINT", "请填写完整接口地址");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new ApiError(
      422,
      "AI_ENDPOINT",
      "接口必须使用 HTTPS，本机服务可使用 HTTP",
    );
  if (url.username || url.password || url.search || url.hash)
    throw new ApiError(
      422,
      "AI_ENDPOINT",
      "接口地址不能包含账号、密钥、查询参数或锚点",
    );
  return url
    .toString()
    .replace(/\/$/, "")
    .replace(/\/chat\/completions$/, "");
}
let saving = Promise.resolve();
export async function saveSettings(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(
      422,
      "AI_CONFIG_INVALID",
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("；"),
    );
  const previous = saving;
  let release!: () => void;
  saving = new Promise<void>((r) => (release = r));
  await previous;
  try {
    const old = await readSettings();
    const req = parsed.data;
    const settings: AISettings = {
      ...req,
      ...Object.fromEntries(
        [
          "dailyTokenLimit",
          "monthlyTokenLimit",
          "usageWarnPercent",
          "enforceBudget",
        ]
          .filter((k) => !(k in (input as object)))
          .map((k) => [k, old[k as keyof AISettings]]),
      ),
      baseUrl: validateEndpoint(req.baseUrl),
      apiKey: req.clearKey ? "" : req.apiKey?.trim() || old.apiKey,
    };
    if (
      settings.baseUrl !== validateEndpoint(old.baseUrl) &&
      old.apiKey &&
      !req.apiKey?.trim() &&
      !req.clearKey
    )
      throw new ApiError(
        422,
        "AI_KEY_REENTRY",
        "接口地址已变更，请重新输入该服务的密钥",
      );
    if (settings.enabled && (!settings.model || !settings.apiKey))
      throw new ApiError(
        422,
        "AI_CONFIG_INVALID",
        "启用 AI 前请填写模型名称和密钥",
      );
    let raw = "";
    try {
      raw = await fs.readFile(settingsPath, "utf8");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    raw = raw
      .split("\n")
      .filter(
        (line) =>
          !keys.some((key) =>
            new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line),
          ),
      )
      .join("\n")
      .trim();
    const values = [
      String(settings.enabled),
      settings.baseUrl,
      settings.model,
      settings.apiKey,
      settings.mode,
      settings.temperature === null ? "auto" : String(settings.temperature),
      String(settings.maxTokens),
      String(settings.timeoutSeconds),
      JSON.stringify(settings.systemPrompt),
      settings.tokenParameter,
      String(settings.dailyTokenLimit),
      String(settings.monthlyTokenLimit),
      String(settings.usageWarnPercent),
      String(settings.enforceBudget),
    ];
    const block = keys
      .map((key, i) => `${key}=${JSON.stringify(values[i])}`)
      .join("\n");
    // parseEnv does not unescape JSON; store prompt as base64 to preserve multiline text.
    const final = block.replace(
      /^CMS_AI_SYSTEM_PROMPT=.*$/m,
      `CMS_AI_SYSTEM_PROMPT=${Buffer.from(settings.systemPrompt).toString("base64")}`,
    );
    await fs.mkdir(path.dirname(settingsPath), {
      recursive: true,
      mode: 0o700,
    });
    const tmp = `${settingsPath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, `${raw ? raw + "\n\n" : ""}${final}\n`, {
      mode: 0o600,
    });
    await fs.rename(tmp, settingsPath);
    await fs.chmod(settingsPath, 0o600);
    return publicSettings(settings);
  } finally {
    release();
  }
}
