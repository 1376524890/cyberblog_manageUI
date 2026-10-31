import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
if (
  !process.env.CMS_REPO_PATH?.includes("test-fixtures/") ||
  !process.env.CMS_AI_ENV_FILE?.includes("test-fixtures/")
)
  throw new Error("Use isolated fixtures");
let modelRequests = 0,
  generationRequests = 0,
  mode = "normal",
  modelsFail = false;
const secret = "observability-test-key";
const mock = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString())
    : {};
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    modelRequests++;
    if (modelsFail) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    res.end(
      JSON.stringify({
        data: [
          { id: "test-model" },
          { id: "test-model" },
          { id: "second-model" },
          { id: 55 },
          null,
        ],
      }),
    );
    return;
  }
  generationRequests++;
  if (mode === "error") {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: secret } }));
    return;
  }
  let message = { role: "assistant", content: "OK" };
  if (body.tools) {
    const tool = body.tools[0]?.function?.name;
    if (tool === "cms_connection_check")
      message = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "test-check",
            type: "function",
            function: { name: tool, arguments: '{"ok":true}' },
          },
        ],
      };
    else if (!body.messages.some((m) => m.role === "tool"))
      message = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "lookup",
            type: "function",
            function: {
              name: "list_content",
              arguments: '{"collection":"posts"}',
            },
          },
        ],
      };
  }
  const usage =
    mode === "missing"
      ? undefined
      : mode === "zero"
        ? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        : {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
            prompt_tokens_details: { cached_tokens: 4 },
            completion_tokens_details: { reasoning_tokens: 3 },
          };
  res.end(
    JSON.stringify({
      choices: [
        { message, finish_reason: mode === "truncated" ? "length" : "stop" },
      ],
      usage,
    }),
  );
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${mock.address().port}/v1`;
await import("../server/src/index.ts");
const base = `http://127.0.0.1:${process.env.PORT ?? 18792}/api/v1`;
for (let i = 0; i < 30; i++) {
  try {
    await fetch(base + "/auth/me");
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
let token = "",
  passed = 0;
const check = (label, value) => {
  assert.ok(value, label);
  console.log("✓", label);
  passed++;
};
async function req(method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {}
  return { status: r.status, data, raw };
}
let r = await req("GET", "/ai/usage");
check("用量接口需要认证", r.status === 401);
r = await req("GET", "/ai/diagnostics");
check("诊断结果需要认证", r.status === 401);
token = (await req("POST", "/auth/login", { username: "cyberclubadmin", password: "admin123" })).data.token;
r = await req("GET", "/ai/usage");
check(
  "初次使用有准确空状态",
  r.status === 200 && r.data.totals.requests === 0 && r.data.totals.total === 0,
);
r = await req("POST", "/ai/models", { baseUrl: origin, apiKey: secret });
check(
  "保存前可获取模型 ID",
  r.status === 200 && r.data.items.join(",") === "second-model,test-model",
);
check("模型 ID 去重并过滤非法项", r.data.count === 2);
check(
  "自动发现不会保存输入密钥",
  (await req("GET", "/ai/settings")).data.hasKey === false,
);
r = await req("POST", "/ai/models", { baseUrl: origin, apiKey: secret });
check("模型列表使用缓存", r.data.cached && modelRequests === 1);
r = await req("POST", "/ai/models", {
  baseUrl: origin,
  apiKey: secret,
  force: true,
});
check("手动刷新可绕过缓存", !r.data.cached && modelRequests === 2);
let settings = {
  enabled: false,
  baseUrl: origin,
  model: "test-model",
  apiKey: secret,
  mode: "tools",
  temperature: null,
  maxTokens: 1024,
  timeoutSeconds: 10,
  systemPrompt: "",
  tokenParameter: "max_tokens",
  dailyTokenLimit: 1000,
  monthlyTokenLimit: 10000,
  usageWarnPercent: 80,
  enforceBudget: false,
};
r = await req("PUT", "/ai/settings", settings);
check(
  "用量额度随配置保存",
  r.status === 200 && r.data.dailyTokenLimit === 1000,
);
r = await req("POST", "/ai/diagnostics", {});
check(
  "未启用助手也可测试连接",
  r.status === 200 &&
    r.data.ok &&
    r.data.checks.some((c) => c.name === "实际文本生成" && c.status === "pass"),
);
check(
  "诊断包含耗时和真实用量",
  r.data.durationMs >= 0 && r.data.usage.total_tokens === 20,
);
r = await req("POST", "/ai/diagnostics", { includeTools: true });
check(
  "支持实际工具调用测试",
  r.data.ok &&
    r.data.checks.some((c) => c.name === "工具调用兼容" && c.status === "pass"),
);
check(
  "工具测试累计两次调用用量",
  r.data.usage.requests === 2 && r.data.usage.total_tokens === 40,
);
r = await req("GET", "/ai/diagnostics");
check("最近诊断可持久化读取", r.data.result?.ok === true);
settings.enabled = true;
await req("PUT", "/ai/settings", settings);
r = await req("POST", "/ai/edit", {
  mode: "format",
  body: "PRIVATE_DRAFT_MARKER",
});
check(
  "编辑返回输入输出明细",
  r.data.usage.prompt_tokens === 12 && r.data.usage.completion_tokens === 8,
);
r = await req("GET", "/ai/usage");
check(
  "监控覆盖连接测试和编辑",
  r.data.totals.requests === 4 && r.data.totals.total === 80,
);
check(
  "缓存与推理不重复计入总量",
  r.data.totals.cached === 16 &&
    r.data.totals.reasoning === 12 &&
    r.data.totals.total === 80,
);
check(
  "日期按北京时间统计",
  r.data.timezone === "Asia/Shanghai" && r.data.today.total === 80,
);
mode = "missing";
await req("POST", "/ai/edit", { mode: "format", body: "test" });
r = await req("GET", "/ai/usage");
check(
  "缺失用量标记未上报而非零",
  r.data.totals.unreportedRequests === 1 &&
    r.data.recent[0].total === null &&
    r.data.totals.total === 80,
);
mode = "zero";
await req("POST", "/ai/edit", { mode: "format", body: "test" });
r = await req("GET", "/ai/usage");
check(
  "真实零用量与未上报区分",
  r.data.recent[0].total === 0 && r.data.totals.reportedRequests === 5,
);
mode = "error";
r = await req("POST", "/ai/edit", { mode: "format", body: "test" });
check(
  "认证错误返回明确原因且不泄露密钥",
  r.status === 502 &&
    r.data.error.code === "AI_AUTH_ERROR" &&
    !r.raw.includes(secret),
);
mode = "truncated";
await req("POST", "/ai/edit", { mode: "format", body: "test" });
r = await req("GET", "/ai/usage");
check(
  "截断请求仍计入已产生用量",
  r.data.totals.total === 100 && r.data.totals.failed === 2,
);
mode = "normal";
const chatResponse = await fetch(base + "/ai/chat", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ messages: [{ role: "user", content: "查看文章" }] }),
});
const stream = await chatResponse.text();
const event = stream.split("\n\n").find((e) => e.includes("event: result"));
const answer = JSON.parse(
  event
    .split("\n")
    .find((l) => l.startsWith("data:"))
    .slice(5),
);
check(
  "对话统计包含所有工具循环请求",
  answer.usage.requests === 2 && answer.usage.total_tokens === 40,
);
r = await req("GET", "/ai/usage");
check(
  "对话请求用途被正确标记",
  r.data.recent.filter((x) => x.kind === "chat").length === 2,
);
modelsFail = true;
r = await req("POST", "/ai/diagnostics", {});
check(
  "不支持模型列表不阻断实际生成",
  r.data.ok &&
    r.data.checks.some(
      (c) => c.name === "模型列表与认证" && c.status === "warning",
    ),
);
modelsFail = false;
const used = (await req("GET", "/ai/usage")).data.today.total;
settings.dailyTokenLimit = used + 10;
settings.usageWarnPercent = 80;
await req("PUT", "/ai/settings", settings);
r = await req("GET", "/ai/usage");
check("达到预警比例显示告警", r.data.budgets.daily.state === "warning");
settings.dailyTokenLimit = used;
settings.enforceBudget = true;
await req("PUT", "/ai/settings", settings);
const before = generationRequests;
r = await req("POST", "/ai/edit", { mode: "format", body: "blocked" });
check(
  "达到额度阻止后续付费请求",
  r.status === 429 &&
    r.data.error.code === "AI_TOKEN_BUDGET" &&
    generationRequests === before,
);
r = await req("POST", "/ai/models", { force: true });
check("额度用尽仍能读取模型列表", r.status === 200);
settings.enforceBudget = false;
await req("PUT", "/ai/settings", settings);
r = await req("POST", "/ai/edit", { mode: "format", body: "allowed" });
check("仅监控模式不阻止生成", r.status === 200);
const { apiKey, ...oldClient } = settings;
delete oldClient.dailyTokenLimit;
delete oldClient.monthlyTokenLimit;
delete oldClient.usageWarnPercent;
delete oldClient.enforceBudget;
r = await req("PUT", "/ai/settings", oldClient);
check(
  "旧客户端保存不会清空额度配置",
  r.data.dailyTokenLimit === used && r.data.monthlyTokenLimit === 10000,
);
r = await req("POST", "/ai/models", { baseUrl: origin + "/different" });
check(
  "改变地址后不会自动转发已保存密钥",
  r.status === 422 && r.data.error.code === "AI_KEY_REENTRY",
);
settings.model = "second-model";
await req("PUT", "/ai/settings", settings);
await req("POST", "/ai/edit", { mode: "format", body: "second" });
r = await req("GET", "/ai/usage?days=7&model=second-model");
check(
  "模型筛选不改变全局额度总计",
  r.data.totals.requests === 1 &&
    r.data.budgets.daily.used > r.data.totals.total,
);
r = await req("GET", "/ai/diagnostics");
check("模型配置变化后不展示旧诊断", r.data.result === null);
mode = "error";
r = await req("POST", "/ai/diagnostics", {});
check(
  "失败诊断也显示真实调用次数",
  !r.data.ok &&
    r.data.usage.requests === 1 &&
    r.data.usage.unreported_requests === 1,
);
mode = "truncated";
r = await req("POST", "/ai/diagnostics", {});
check(
  "截断诊断保留已消耗的 token",
  !r.data.ok && r.data.usage.total_tokens === 20,
);
mode = "normal";
settings.maxTokens = 2048;
await req("PUT", "/ai/settings", settings);
r = await req("GET", "/ai/diagnostics");
check("长度参数变化后要求重新诊断", r.data.result === null);
r = await req("GET", "/ai/usage?days=abc");
check("拒绝非法监控查询参数", r.status === 400);
const { normalizeUsage, aggregateUsages, chinaDate } =
  await import("../server/src/ai/usage.ts");
check(
  "兼容输入输出格式别名",
  normalizeUsage({ input_tokens: 10, output_tokens: 4 }).total === 14,
);
check(
  "非法负数不当作用量",
  normalizeUsage({ prompt_tokens: -2, completion_tokens: "4" }).total === null,
);
check(
  "部分上报的对话总量不伪造完整值",
  aggregateUsages([{ total_tokens: 20 }, null]).total_tokens === null &&
    aggregateUsages([{ total_tokens: 20 }, null]).known_total_tokens === 20,
);
check(
  "北京时间跨日正确",
  chinaDate(new Date("2026-10-30T17:00:00Z")) === "2026-10-31",
);
const folder = path.join(path.dirname(process.env.CMS_AI_ENV_FILE), ".runtime");
const names = await fs.readdir(folder);
const ledger = names.find((n) => n.startsWith("ai-usage-"));
const raw = await fs.readFile(path.join(folder, ledger), "utf8");
check(
  "用量文件不含正文或密钥",
  !raw.includes(secret) && !raw.includes("PRIVATE_DRAFT_MARKER"),
);
check(
  "用量记录文件权限为 600",
  ((await fs.stat(path.join(folder, ledger))).mode & 0o777) === 0o600,
);
check(
  "持久化文件包含所有模型请求",
  raw.trim().split("\n").length ===
    (await req("GET", "/ai/usage?days=90")).data.totals.requests,
);
console.log(`AI 监控验收：${passed} 项通过`);
mock.close();
process.exit(0);
