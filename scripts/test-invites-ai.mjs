import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cms-invite-ai-"));
fs.writeFileSync(
  path.join(root, ".cms-disposable"),
  "cyber-cms-generated-v1\n",
);
const repo = path.join(root, "blog");
fs.mkdirSync(repo);
const git = (...args) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
git("init", "-b", "main");
git("config", "user.name", "Invite QA");
git("config", "user.email", "qa@example.invalid");
for (const c of ["posts", "dynamic", "projects", "spec"])
  fs.mkdirSync(path.join(repo, "src/content", c), { recursive: true });
fs.writeFileSync(
  path.join(repo, "src/content/posts/live.md"),
  "---\ntitle: Existing\npublished: 2026-10-31\ncategory: 技术分享\nseries: 已有系列\n---\nLIVE_CONTENT_SECRET",
);
git("add", ".");
git("commit", "-m", "test: fixture");
Object.assign(process.env, {
  CMS_REPO_PATH: repo,
  CMS_ADMIN_PASSWORD: "invite-admin-test",
  CMS_CREATOR_PASSWORD: "invite-creator-test",
  CMS_SESSION_SECRET: randomUUID(),
  CMS_AI_ENV_FILE: path.join(root, "ai.env"),
  CMS_DAILY_SCHEDULER: "off",
  CMS_WEB_DIST: path.join(root, "no-dist"),
  PORT: "18947",
  HOST: "127.0.0.1",
});
let modelCalls = 0,
  toolCalls = [],
  requests = [],
  missingUsage = false,
  providerError = 0;
const mock = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  modelCalls++;
  requests.push(body);
  res.setHeader("Content-Type", "application/json");
  if (providerError) {
    res.statusCode = providerError;
    res.end("{}");
    return;
  }
  const last = body.messages.at(-1);
  const jsonMode =
    !body.tools && body.messages[0].content.includes("JSON 协议");
  let message = { role: "assistant", content: "已准备好，请核对卡片。" };
  if (jsonMode)
    message.content = JSON.stringify({
      reply: "请核对草稿操作",
      calls: last.content.startsWith("以下是工具") ? [] : toolCalls,
    });
  else if (body.tools && last.role !== "tool" && toolCalls.length)
    message = {
      role: "assistant",
      content: null,
      tool_calls: toolCalls.map((call, i) => ({
        id: `call-${i}`,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      })),
    };
  res.end(
    JSON.stringify({
      choices: [{ message, finish_reason: "stop" }],
      ...(!missingUsage
        ? {
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          }
        : {}),
    }),
  );
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
await import("../server/src/index.ts");
const base = "http://127.0.0.1:18947/api/v1";
let passed = 0,
  ip = 0;
function check(label, ok) {
  assert.ok(ok, label);
  passed++;
  console.log("✓", label);
}
async function req(method, url, data, token = "") {
  const r = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": `invite-qa-${++ip}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await r.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return { status: r.status, data: value, raw: text };
}
async function login(username, password) {
  return (await req("POST", "/auth/login", { username, password })).data.token;
}
async function chat(token) {
  const r = await req(
    "POST",
    "/ai/chat",
    { messages: [{ role: "user", content: "按要求准备草稿，请遵守权限" }] },
    token,
  );
  const events =
    typeof r.data === "string"
      ? r.data.split("\n\n").map((block) => {
          const event = block.match(/^event: (.*)$/m)?.[1],
            raw = block.match(/^data: (.*)$/m)?.[1];
          return { event, data: raw ? JSON.parse(raw) : null };
        })
      : [];
  return {
    ...r,
    result: events.find((e) => e.event === "result")?.data,
    error: events.find((e) => e.event === "error")?.data,
  };
}
const data = (slug) => ({
  collection: "posts",
  slug,
  data: { title: "创作者新稿", published: "2026-10-31", category: "技术分享" },
  body: "# 私有草稿正文",
});
try {
  const admin = await login("cyberclubadmin", "invite-admin-test");
  check(
    "未登录不能生成邀请码",
    (await req("POST", "/admin/invites", {})).status === 401,
  );
  let r = await req("POST", "/admin/invites", { count: 8, days: 7 }, admin);
  check(
    "管理员可批量生成单次邀请码",
    r.status === 201 && r.data.items.length === 8,
  );
  const invites = r.data.items;
  const overview = await req("GET", "/admin/accounts", undefined, admin);
  check(
    "邀请码列表不回显完整邀请码与哈希",
    !overview.raw.includes(invites[0].code) && !overview.raw.includes('"hash"'),
  );
  check(
    "没有邀请码不能注册",
    (
      await req("POST", "/auth/register", {
        username: "noinvite",
        password: "strong-test-password",
      })
    ).status === 422,
  );
  check(
    "邀请码不能注册管理员角色",
    (
      await req("POST", "/auth/register", {
        username: "eviladmin",
        password: "strong-test-password",
        inviteCode: invites[0].code,
        role: "admin",
      })
    ).status === 422,
  );
  check(
    "拒绝弱密码",
    (
      await req("POST", "/auth/register", {
        username: "weakpass",
        password: "123",
        inviteCode: invites[0].code,
      })
    ).status === 422,
  );
  r = await req("POST", "/auth/register", {
    username: "Alice_QA",
    password: "alice-test-password",
    inviteCode: invites[0].code,
  });
  check(
    "邀请码注册仅创建创作者并自动登录",
    r.status === 201 &&
      r.data.user.role === "creator" &&
      r.data.user.username === "alice_qa",
  );
  let alice = r.data.token;
  const aliceIdentity = r.data.user;
  check(
    "注册会话可读取本人身份",
    (await req("GET", "/auth/me", undefined, alice)).data.username ===
      "alice_qa",
  );
  check(
    "邀请码只可使用一次",
    (
      await req("POST", "/auth/register", {
        username: "again",
        password: "strong-test-password",
        inviteCode: invites[0].code,
      })
    ).status === 422,
  );
  r = await req("POST", "/auth/register", {
    username: "bob_qa",
    password: "bob-test-password",
    inviteCode: invites[1].code,
  });
  const bob = r.data.token,
    bobIdentity = r.data.user;
  check(
    "第二位创作者独立注册",
    r.status === 201 && bobIdentity.userId !== aliceIdentity.userId,
  );
  const race = await Promise.all([
    req("POST", "/auth/register", {
      username: "race_one",
      password: "race-test-password",
      inviteCode: invites[2].code,
    }),
    req("POST", "/auth/register", {
      username: "race_two",
      password: "race-test-password",
      inviteCode: invites[2].code,
    }),
  ]);
  check(
    "并发注册不能重复消耗邀请码",
    race.filter((r) => r.status === 201).length === 1 &&
      race.filter((r) => r.status === 422).length === 1,
  );
  check(
    "管理员可撤销邀请码",
    (await req("POST", `/admin/invites/${invites[3].id}/revoke`, {}, admin))
      .status === 200,
  );
  check(
    "被撤销的邀请码不能注册",
    (
      await req("POST", "/auth/register", {
        username: "revoked",
        password: "strong-test-password",
        inviteCode: invites[3].code,
      })
    ).status === 422,
  );
  const accountPath = path.join(repo, ".git/cms-private/accounts.json");
  let store = JSON.parse(fs.readFileSync(accountPath));
  store.invites.find((i) => i.id === invites[4].id).expiresAt =
    "2020-01-01T00:00:00Z";
  fs.writeFileSync(accountPath, JSON.stringify(store));
  check(
    "过期的邀请码不能注册",
    (
      await req("POST", "/auth/register", {
        username: "expired",
        password: "strong-test-password",
        inviteCode: invites[4].code,
      })
    ).status === 422,
  );
  check(
    "保留现有管理员账号",
    (
      await req("POST", "/auth/register", {
        username: "cyberclubadmin",
        password: "strong-test-password",
        inviteCode: invites[5].code,
      })
    ).status === 409,
  );
  check(
    "名称冲突不会消耗邀请码",
    (
      await req("POST", "/auth/register", {
        username: "later_user",
        password: "strong-test-password",
        inviteCode: invites[5].code,
      })
    ).status === 201,
  );
  check(
    "账号文件不保存明文密码或邀请码",
    !fs.readFileSync(accountPath, "utf8").includes("alice-test-password") &&
      !fs.readFileSync(accountPath, "utf8").includes(invites[0].code),
  );
  check(
    "账号文件权限为 600",
    (fs.statSync(accountPath).mode & 0o777) === 0o600,
  );
  for (const [method, url, body] of [
    ["GET", "/admin/accounts"],
    ["POST", "/admin/invites", {}],
    ["PUT", `/admin/users/${bobIdentity.userId}`, { active: false }],
    ["POST", `/admin/invites/${invites[6].id}/revoke`, {}],
    ["GET", "/ai/settings"],
    ["GET", "/ai/usage"],
    ["POST", "/publish", {}],
  ])
    check(
      `注册创作者禁止 ${method} ${url}`,
      (await req(method, url, body, alice)).status === 403,
    );
  const beforeHead = git("rev-parse", "HEAD");
  const aliceDraft = (await req("POST", "/drafts", data("alice-draft"), alice))
    .data;
  const bobDraft = (await req("POST", "/drafts", data("bob-draft"), bob)).data;
  check(
    "多账号草稿列表隔离",
    !(await req("GET", "/drafts", undefined, alice)).data.items.some(
      (d) => d.id === bobDraft.id,
    ),
  );
  check(
    "不能读取其他创作者草稿",
    (await req("GET", `/drafts/${bobDraft.id}`, undefined, alice)).status ===
      404,
  );
  check(
    "不能修改其他创作者草稿",
    (
      await req(
        "PUT",
        `/drafts/${bobDraft.id}`,
        { ...data("bob-draft"), revision: 1 },
        alice,
      )
    ).status === 404,
  );
  const settings = {
    enabled: true,
    baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
    apiKey: "mock-invite-key",
    model: "mock-model",
    mode: "tools",
    maxTokens: 256,
    temperature: null,
    timeoutSeconds: 10,
    systemPrompt: "ADMIN_PRIVATE_PROMPT",
  };
  check(
    "管理员可配置隔离模型",
    (await req("PUT", "/ai/settings", settings, admin)).status === 200,
  );
  r = await req("GET", "/ai/status", undefined, alice);
  check(
    "创作者只读取安全模型状态及本人额度",
    r.status === 200 &&
      r.data.quota.limit === 3000000 &&
      !r.raw.includes("mock-invite-key") &&
      !r.raw.includes("baseUrl"),
  );
  toolCalls = [
    { name: "get_site_status", arguments: {} },
    { name: "start_github_daily", arguments: {} },
    { name: "get_content", arguments: { collection: "posts", slug: "live" } },
    { name: "get_content", arguments: { draftId: bobDraft.id } },
    { name: "propose_change", arguments: { operation: "publish" } },
    {
      name: "propose_change",
      arguments: { operation: "delete", collection: "posts", slug: "live" },
    },
  ];
  r = await chat(alice);
  check(
    "创作者可使用 AI 工作台但越权工具不产生提案",
    r.status === 200 && r.result && r.result.proposals.length === 0,
  );
  check(
    "模型只收到创作者专用工具",
    requests[0].tools.every(
      (t) =>
        ![
          "get_site_status",
          "start_github_daily",
          "get_github_daily_status",
        ].includes(t.function.name),
    ) &&
      requests[0].tools
        .find((t) => t.function.name === "propose_change")
        .function.parameters.properties.operation.enum.join(",") ===
        "create,update,submit",
  );
  check(
    "模型请求不含站点正文、他人草稿或管理员私有提示词",
    !JSON.stringify(requests).includes("LIVE_CONTENT_SECRET") &&
      !JSON.stringify(requests).includes("ADMIN_PRIVATE_PROMPT") &&
      !JSON.stringify(requests).includes(bobDraft.body),
  );
  toolCalls = [
    {
      name: "propose_change",
      arguments: { operation: "create", ...data("ai-created-private") },
    },
  ];
  r = await chat(alice);
  const proposal = r.result.proposals[0];
  check(
    "AI 新建仅生成私有草稿卡片",
    proposal?.scope === "draft" &&
      !fs.existsSync(
        path.join(repo, "src/content/posts/ai-created-private.md"),
      ),
  );
  check(
    "其他账号不能确认本人的卡片",
    (await req("POST", `/ai/actions/${proposal.id}/apply`, {}, bob)).status ===
      404,
  );
  r = await req("POST", `/ai/actions/${proposal.id}/apply`, {}, alice);
  let aiDraft = r.data;
  check(
    "确认卡片只保存私有草稿",
    r.status === 200 &&
      aiDraft.owner === "alice_qa" &&
      aiDraft.status === "draft" &&
      git("rev-parse", "HEAD") === beforeHead,
  );
  check(
    "确认卡片具有幂等性",
    (await req("POST", `/ai/actions/${proposal.id}/apply`, {}, alice)).data
      .id === aiDraft.id,
  );
  toolCalls = [
    {
      name: "propose_change",
      arguments: {
        operation: "update",
        draftId: aiDraft.id,
        body: "# AI 更新后的正文",
      },
    },
  ];
  r = await chat(alice);
  const update = r.result.proposals[0];
  aiDraft = (await req("POST", `/ai/actions/${update.id}/apply`, {}, alice))
    .data;
  check("AI 可更新自己的草稿", aiDraft.body === "# AI 更新后的正文");
  toolCalls = [
    {
      name: "propose_change",
      arguments: { operation: "submit", draftId: aiDraft.id },
    },
  ];
  r = await chat(alice);
  const submit = r.result.proposals[0];
  r = await req("POST", `/ai/actions/${submit.id}/apply`, {}, alice);
  check(
    "AI 提交只进入待发布审核",
    r.status === 200 &&
      r.data.status === "pending" &&
      !fs.existsSync(
        path.join(repo, "src/content/posts/ai-created-private.md"),
      ),
  );
  check(
    "本人 AI 历史不泄露他人记录",
    (await req("GET", "/ai/history", undefined, bob)).data.items.length === 0 &&
      (await req("GET", "/ai/history", undefined, alice)).data.items.length ===
        3,
  );
  toolCalls = [
    {
      name: "propose_change",
      arguments: {
        operation: "update",
        collection: "posts",
        slug: "live",
        data: { title: "管理员更改" },
      },
    },
  ];
  r = await chat(admin);
  const adminProposal = r.result.proposals[0];
  check(
    "创作者不能应用管理员卡片",
    (await req("POST", `/ai/actions/${adminProposal.id}/apply`, {}, alice))
      .status === 404,
  );
  check(
    "管理员卡片未被越权确认消耗",
    (await req("POST", `/ai/actions/${adminProposal.id}/apply`, {}, admin))
      .status === 200,
  );
  await req("PUT", "/ai/settings", { ...settings, mode: "json" }, admin);
  toolCalls = [
    {
      name: "propose_change",
      arguments: { operation: "create", ...data("json-private") },
    },
  ];
  r = await chat(alice);
  check(
    "JSON 协议同样只生成私有草稿",
    r.result?.proposals[0]?.scope === "draft",
  );
  await req("PUT", "/ai/settings", settings, admin);
  toolCalls = [];
  let quota = (await req("GET", "/ai/quota", undefined, alice)).data;
  check(
    "多轮对话按实际输入输出累积个人用量",
    quota.used > 30 && quota.reserved === 0 && quota.limit === 3000000,
  );
  check(
    "不同创作者额度独立",
    (await req("GET", "/ai/quota", undefined, bob)).data.used === 0,
  );
  const spent = quota.used;
  alice = await login("ALICE_QA", "alice-test-password");
  check(
    "重新登录不会重置额度",
    (await req("GET", "/ai/quota", undefined, alice)).data.used === spent,
  );
  missingUsage = true;
  check(
    "编辑助手与工作台共用个人额度",
    (await req("POST", "/ai/edit", { mode: "format", body: "test" }, alice))
      .status === 200,
  );
  quota = (await req("GET", "/ai/quota", undefined, alice)).data;
  check(
    "服务商不报用量时保守扣减而非免费",
    quota.estimated > 0 && quota.used > spent && quota.reserved === 0,
  );
  missingUsage = false;
  providerError = 401;
  const beforeError = quota.used;
  await req("POST", "/ai/edit", { mode: "format", body: "test" }, alice);
  check(
    "明确未执行的上游认证错误释放预留",
    (await req("GET", "/ai/quota", undefined, alice)).data.used === beforeError,
  );
  providerError = 0;
  const { requestIdentity, actorKey } =
    await import("../server/src/core/request-context.ts");
  const { reserveUserTokens, settleUserTokens, quotaFor } =
    await import("../server/src/ai/quota.ts");
  const reservations = await requestIdentity.run(bobIdentity, () =>
    Promise.allSettled([
      reserveUserTokens(2000000),
      reserveUserTokens(2000000),
    ]),
  );
  check(
    "并发预留不能超出每日 300 万",
    reservations.filter((r) => r.status === "fulfilled").length === 1 &&
      reservations.filter((r) => r.status === "rejected").length === 1,
  );
  const ticket = reservations.find((r) => r.status === "fulfilled").value;
  await settleUserTokens(ticket, 50);
  check(
    "预留按实际用量结算且退还剩余",
    (await quotaFor(bobIdentity)).used === 50 &&
      (await quotaFor(bobIdentity)).reserved === 0,
  );
  const tomorrow = new Date(Date.now() + 86400000);
  check(
    "次日额度独立恢复",
    (await quotaFor(bobIdentity, tomorrow)).used === 0 &&
      (await quotaFor(bobIdentity, tomorrow)).remaining === 3000000,
  );
  quota = await quotaFor(aliceIdentity);
  check(
    "重置时间采用北京时间零点",
    new Date(quota.resetsAt).getUTCHours() === 16,
  );
  const ledgerPath = path.join(
    repo,
    ".git/cms-private/ai-quota",
    quota.date + ".json",
  );
  let ledger = JSON.parse(fs.readFileSync(ledgerPath));
  ledger.accounts[actorKey(aliceIdentity)].used = 2999999;
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  const beforeCalls = modelCalls;
  r = await req("POST", "/ai/edit", { mode: "format", body: "test" }, alice);
  check(
    "额度不足在模型调用前拒绝",
    r.status === 429 &&
      r.data.error.code === "AI_USER_DAILY_LIMIT" &&
      modelCalls === beforeCalls,
  );
  check(
    "管理员面板显示每个人的额度",
    (await req("GET", "/admin/accounts", undefined, admin)).data.users.find(
      (u) => u.username === "alice_qa",
    ).quota.used === 2999999,
  );
  await req(
    "PUT",
    `/admin/users/${aliceIdentity.userId}`,
    { active: false },
    admin,
  );
  check(
    "停用立即使已有会话失效",
    (await req("GET", "/auth/me", undefined, alice)).status === 401,
  );
  check(
    "停用账号不能重新登录",
    (
      await req("POST", "/auth/login", {
        username: "alice_qa",
        password: "alice-test-password",
      })
    ).status === 401,
  );
  await req(
    "PUT",
    `/admin/users/${aliceIdentity.userId}`,
    { active: true },
    admin,
  );
  check(
    "重新启用不会复活旧会话",
    (await req("GET", "/auth/me", undefined, alice)).status === 401,
  );
  alice = await login("alice_qa", "alice-test-password");
  check(
    "重新启用后可登录且保留用量",
    (await req("GET", "/ai/quota", undefined, alice)).data.used === 2999999,
  );
  const orphan = await requestIdentity.run(bobIdentity, () =>
    reserveUserTokens(1000),
  );
  const cwd = path.resolve(new URL("..", import.meta.url).pathname);
  const childCode = `const { quotaFor } = await import('./server/src/ai/quota.ts'); console.log(JSON.stringify(await quotaFor(${JSON.stringify(bobIdentity)})));`;
  const recovered = JSON.parse(
    execFileSync(
      "node",
      [
        "--import",
        "./server/node_modules/tsx/dist/loader.mjs",
        "--input-type=module",
        "-e",
        childCode,
      ],
      { cwd, env: process.env, encoding: "utf8" },
    ),
  );
  check(
    "服务重启对未完成请求保守记账，不重置额度",
    recovered.used === 1050 &&
      recovered.reserved === 0 &&
      recovered.estimated === 1000,
  );
  const goodLedger = fs.readFileSync(ledgerPath);
  fs.writeFileSync(ledgerPath, "broken");
  r = await req("POST", "/ai/edit", { mode: "format", body: "test" }, bob);
  check(
    "损坏的额度账目拒绝调用而非重置",
    r.status === 503 && modelCalls === beforeCalls,
  );
  fs.writeFileSync(ledgerPath, goodLedger);
  check(
    "用户、邀请码和用量不会进入 Git",
    !git("ls-files").includes("cms-private"),
  );
  console.log(`邀请码、创作者 AI 与个人额度：${passed} 项通过`);
  fs.rmSync(root, { recursive: true, force: true });
  mock.close();
  process.exit(0);
} catch (e) {
  console.error(e);
  console.error("保留测试现场：", root);
  mock.close();
  process.exit(1);
}
