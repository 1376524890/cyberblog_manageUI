import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
const repo = process.env.CMS_REPO_PATH;
if (!repo?.includes("test-fixtures/"))
  throw new Error("AI tests require isolated test-fixtures");
if (!process.env.CMS_AI_ENV_FILE?.includes("test-fixtures/"))
  throw new Error("AI tests require isolated configuration");
const key = "test-only-not-a-live-secret";
let requests = [],
  replyMode = "edit",
  bad = false;
const mock = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString())
    : null;
  requests.push({
    path: req.url,
    authorization: req.headers.authorization,
    body,
  });
  res.setHeader("Content-Type", "application/json");
  if (bad) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: "upstream echoed " + key } }));
    return;
  }
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
    return;
  }
  let message = {
    role: "assistant",
    content: "## 整理后的正文\n\n保留代码与事实。",
  };
  if (replyMode === "metadata")
    message.content = JSON.stringify({
      title: "建议标题",
      description: "建议摘要",
      tags: ["测试"],
    });
  if (replyMode === "truncated") {
    res.end(
      JSON.stringify({ choices: [{ message, finish_reason: "length" }] }),
    );
    return;
  }
  if (replyMode === "tool" || replyMode === "json") {
    const hasToolResult = body.messages.some(
      (m) => m.role === "tool" || m.content?.includes("以下是工具"),
    );
    if (hasToolResult)
      message.content =
        replyMode === "json"
          ? JSON.stringify({ reply: "已准备成员更新，等待确认。", calls: [] })
          : "已准备成员更新，等待确认。";
    else {
      const args = {
        operation: "update",
        collection: "projects",
        slug: "ai-member",
        data: { status: "已毕业", tags: ["成员主页", "Python", "校友"] },
        reason: "按要求调整成员状态",
      };
      if (replyMode === "json")
        message.content = JSON.stringify({
          reply: "先准备修改。",
          calls: [{ name: "propose_change", arguments: args }],
        });
      else
        message = {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-test",
              type: "function",
              function: {
                name: "propose_change",
                arguments: JSON.stringify(args),
              },
            },
          ],
        };
    }
  }
  res.end(
    JSON.stringify({
      choices: [{ message, finish_reason: "stop" }],
      usage: { total_tokens: 42 },
    }),
  );
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockPort = mock.address().port;
await import("../server/src/index.ts");
const base = `http://127.0.0.1:${process.env.PORT ?? 18790}/api/v1`;
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
const check = (name, value) => {
  assert.ok(value, name);
  console.log("✓", name);
  passed++;
};
async function req(method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, data: JSON.parse(text), raw: text };
}
async function chat() {
  const r = await fetch(base + "/ai/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "把 ai-member 改为毕业校友" }],
    }),
  });
  const text = await r.text();
  const events = text.split("\n\n").map((e) => {
    const lines = e.split("\n");
    return {
      event: lines
        .find((l) => l.startsWith("event:"))
        ?.slice(6)
        .trim(),
      data: lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join(""),
    };
  });
  const result = events.find((e) => e.event === "result");
  if (!result) throw new Error(text);
  return { data: JSON.parse(result.data), raw: text };
}
let r = await req("GET", "/ai/settings");
check("AI 设置需要认证", r.status === 401);
token = (await req("POST", "/auth/login", { username: "cyberclubadmin", password: "admin123" })).data.token;
r = await req("POST", "/ai/edit", { mode: "format", body: "x" });
check("未配置 AI 时清楚提示", r.status === 409);
const settings = {
  enabled: true,
  baseUrl: `http://127.0.0.1:${mockPort}/v1`,
  model: "test-model",
  apiKey: key,
  mode: "tools",
  temperature: null,
  maxTokens: 2048,
  timeoutSeconds: 10,
  systemPrompt: "第一行\n第二行：保留代码",
  tokenParameter: "max_completion_tokens",
};
r = await req("PUT", "/ai/settings", settings);
check(
  "可保存兼容接口配置",
  r.status === 200 &&
    r.data.hasKey === true &&
    !r.raw.includes(key) &&
    !("apiKey" in r.data),
);
const malformed = await fetch(base + "/ai/settings", {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: '{"apiKey":"' + key,
});
const malformedText = await malformed.text();
check(
  "无效配置请求也不会回显密钥",
  malformed.status === 400 && !malformedText.includes(key),
);
const stat = await fs.stat(process.env.CMS_AI_ENV_FILE);
check(".env 权限为 600", (stat.mode & 0o777) === 0o600);
const env = await fs.readFile(process.env.CMS_AI_ENV_FILE, "utf8");
check(
  "密钥只保存在独立后端 .env",
  env.includes("CMS_AI_API_KEY=") && env.includes(key),
);
r = await req("GET", "/ai/settings");
check(
  "读取配置不回显密钥且保留多行偏好",
  !r.raw.includes(key) && r.data.systemPrompt === settings.systemPrompt,
);
r = await req("PUT", "/ai/settings", { ...settings, apiKey: "" });
check("密钥留空保留已保存值", r.status === 200 && r.data.hasKey);
r = await req("PUT", "/ai/settings", {
  ...settings,
  baseUrl: "http://remote.example/v1",
});
check("拒绝明文远程密钥传输", r.status === 422);
r = await req("PUT", "/ai/settings", {
  ...settings,
  baseUrl: "https://example.com/v1?key=abc",
});
check("拒绝 URL 内夹带密钥", r.status === 422);
r = await req("POST", "/ai/models", {});
check(
  "读取服务商模型列表",
  r.status === 200 && r.data.items[0] === "test-model",
);
r = await req("POST", "/ai/edit", {
  mode: "format",
  body: "# 正文\n\ncode",
  title: "标题",
});
check(
  "编辑接口返回建议而不直接写仓库",
  r.status === 200 && r.data.text.includes("整理后的正文"),
);
let request = requests.at(-1);
check(
  "标准兼容请求与 Bearer 认证",
  request.path === "/v1/chat/completions" &&
    request.authorization === `Bearer ${key}` &&
    request.body.model === "test-model",
);
check(
  "可省略温度并选择兼容长度参数",
  !("temperature" in request.body) &&
    request.body.max_completion_tokens === 2048 &&
    !("max_tokens" in request.body),
);
check(
  "密钥不进入模型消息",
  !JSON.stringify(request.body.messages).includes(key),
);
replyMode = "metadata";
r = await req("POST", "/ai/edit", { mode: "metadata", body: "成员简介" });
check("生成结构化标题摘要与标签", r.data.metadata?.title === "建议标题");
replyMode = "truncated";
r = await req("POST", "/ai/edit", { mode: "rewrite", body: "test" });
check("拒绝截断结果覆盖正文", r.status === 422);
replyMode = "edit";
bad = true;
r = await req("POST", "/ai/test", {});
check("上游错误不会泄露密钥", r.status === 502 && !r.raw.includes(key));
bad = false;
r = await req("GET", "/templates?collection=projects");
check(
  "成员 Markdown 模板可读取",
  r.status === 200 && r.data.items.some((t) => t.id === "member-profile"),
);
r = await req("POST", "/projects", {
  slug: "ai-member",
  data: {
    title: "测试成员",
    published: "2026-10-30",
    status: "member",
    draft: true,
    order: 10,
    tags: ["成员主页"],
    link: [
      {
        label: "GitHub",
        icon: "fa7-brands:github",
        value: "https://github.com/example",
      },
    ],
  },
  body: "# 成员\n\n测试资料。",
});
check("交互成员字段保存兼容博客", r.status === 201);
const imageForm = new FormData();
imageForm.append(
  "file",
  new Blob(
    [
      Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64",
      ),
    ],
    { type: "image/gif" },
  ),
  "avatar.gif",
);
const imageUpload = await fetch(base + "/projects/ai-member/images", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: imageForm,
});
const imageResult = await imageUpload.json();
check(
  "成员支持上传头像",
  imageUpload.status === 201 &&
    imageResult.refPath.startsWith("./images/ai-member/"),
);
let avatarMember = (await req("GET", "/projects/ai-member")).data;
await req("PUT", "/projects/ai-member", {
  data: { image: imageResult.refPath },
  expected: avatarMember.version,
});
check(
  "成员头像随资料保存一起提交",
  (await req("GET", "/git/status")).data.clean,
);
replyMode = "tool";
let chatResult = await chat();
check(
  "工具调用生成待确认卡片",
  chatResult.data.proposals.length === 1 &&
    chatResult.data.proposals[0].state === "pending",
);
let member = (await req("GET", "/projects/ai-member")).data;
check("对话预览不会提前修改内容", member.data.status === "member");
const proposal = chatResult.data.proposals[0];
r = await req("POST", `/ai/actions/${proposal.id}/apply`, {});
check("确认后调用真实接口保存", r.status === 200);
member = (await req("GET", "/projects/ai-member")).data;
check(
  "确认操作字段生效且正文保留",
  member.data.status === "已毕业" && member.body.includes("测试资料"),
);
const head = member.version.head;
r = await req("POST", `/ai/actions/${proposal.id}/apply`, {});
member = (await req("GET", "/projects/ai-member")).data;
check(
  "重复确认不会重复写入提交",
  r.status === 200 && member.version.head === head,
);
chatResult = await chat();
const stale = chatResult.data.proposals[0];
await req("PUT", "/projects/ai-member", {
  data: { description: "其他编辑者修改" },
  expected: member.version,
  body: member.body,
});
r = await req("POST", `/ai/actions/${stale.id}/apply`, {});
check("内容变化后阻止旧 AI 操作覆盖", r.status === 409);
await req("PUT", "/ai/settings", { ...settings, mode: "json" });
replyMode = "json";
chatResult = await chat();
check(
  "无原生工具能力模型可使用 JSON 协议",
  chatResult.data.proposals.length === 1,
);
r = await req("GET", "/ai/history");
check(
  "保存 AI 操作执行记录",
  r.status === 200 &&
    r.data.items.some((i) => i.ok && i.operation === "update") &&
    !r.raw.includes(key),
);
r = await req("POST", "/ai/actions/unknown/apply", {});
check("不能伪造操作编号执行", r.status === 404);
r = await req("POST", "/projects", {
  slug: "unsafe-link",
  data: {
    title: "bad",
    published: "2026-10-30",
    link: [{ label: "bad", value: "javascript:alert(1)" }],
  },
  body: "",
});
check("成员链接拒绝脚本协议", r.status === 422);
// Internal proposal checks do not invoke a provider.
const { propose } = await import("../server/src/ai/actions.ts");
const create = await propose({
  operation: "create",
  collection: "projects",
  slug: "ai-created-member",
  data: { title: "对话创建", published: "2026-10-30" },
  body: "# AI 成员模板",
});
check("AI 创建成员默认草稿", create.data.draft === true);
r = await req("POST", `/ai/actions/${create.id}/apply`, {});
check(
  "可通过确认创建新内容",
  r.status === 200 && r.data.slug === "ai-created-member",
);
const deletion = await propose({
  operation: "delete",
  collection: "projects",
  slug: "ai-created-member",
});
r = await req("POST", `/ai/actions/${deletion.id}/apply`, {});
check("可通过确认删除内容", r.status === 200);
const pub = await propose({ operation: "publish" });
r = await req("POST", `/ai/actions/${pub.id}/apply`, {});
check("可通过确认向测试远端推送", r.status === 200);

let rejected = false;
try {
  await propose({
    operation: "update",
    collection: "projects",
    slug: "../outside",
    data: { status: "x" },
  });
} catch {
  rejected = true;
}
check("AI 操作不能越出内容目录", rejected);
rejected = false;
try {
  await propose({
    operation: "update",
    collection: "posts",
    slug: "cpp-tutorial-01",
    data: { username: "cyberclubadmin", password: "new" },
  });
} catch {
  rejected = true;
}
check("AI 操作不能修改认证/密码字段", rejected);
r = await req("PUT", "/ai/settings", {
  ...settings,
  enabled: false,
  apiKey: "",
  clearKey: true,
});
check("可关闭 AI 并删除密钥", r.status === 200 && !r.data.hasKey);
check(
  "AI .env 不会进入 Git",
  execFileSync("git", ["check-ignore", process.env.CMS_AI_ENV_FILE], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).length > 0,
);
console.log(`AI 验证：${passed} 项通过`);
mock.close();
process.exit(0);
