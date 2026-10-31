import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, createHmac } from "node:crypto";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cms-roles-"));
fs.writeFileSync(
  path.join(root, ".cms-disposable"),
  "cyber-cms-generated-v1\n",
);
const repo = path.join(root, "blog"),
  remote = path.join(root, "remote.git");
fs.mkdirSync(repo);
function git(args, cwd = repo) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
git(["init", "--bare", "-b", "main", remote], root);
git(["init", "-b", "main"]);
git(["config", "user.name", "Role QA"]);
git(["config", "user.email", "qa@example.invalid"]);
for (const c of ["posts", "dynamic", "projects", "spec"])
  fs.mkdirSync(path.join(repo, "src/content", c), { recursive: true });
fs.writeFileSync(
  path.join(repo, "src/content/posts/existing.md"),
  "---\ntitle: Existing\npublished: 2026-10-31\ncategory: 技术分享\nseries: 既有系列\ndraft: false\n---\nExisting content\n",
);
git(["add", "."]);
git(["commit", "-m", "test: fixture"]);
git(["remote", "add", "origin", remote]);
git(["push", "-u", "origin", "main"]);
Object.assign(process.env, {
  CMS_REPO_PATH: repo,
  CMS_ADMIN_PASSWORD: "role-admin-test",
  CMS_CREATOR_PASSWORD: "role-creator-test",
  CMS_SESSION_SECRET: randomUUID(),
  CMS_DAILY_SCHEDULER: "off",
  CMS_WEB_DIST: path.join(root, "no-dist"),
  PORT: "18941",
  HOST: "127.0.0.1",
});
await import("../server/src/index.ts");
const base = "http://127.0.0.1:18941/api/v1";
let passed = 0,
  token = "",
  ip = 0;
async function req(method, url, data, auth = token) {
  const r = await fetch(base + url, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      "Content-Type": "application/json",
      "x-forwarded-for": `qa-${++ip}`,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie"),
  };
}
function check(label, condition) {
  assert.ok(condition, label);
  passed++;
  console.log("✓", label);
}
async function login(username, password) {
  const r = await req("POST", "/auth/login", { username, password }, "");
  check(
    `${username} 登录`,
    r.status === 200 && r.data.user.username === username,
  );
  return r.data.token;
}
function content(slug = "creator-first", collection = "posts") {
  return {
    collection,
    slug,
    data: {
      title: "创作者投稿",
      published: "2026-10-31",
      category: "技术分享",
      series: "既有系列",
      draft: false,
      pinned: true,
    },
    body: "# 需要审核的正文",
  };
}
try {
  check("未登录不能访问稿件", (await req("GET", "/drafts")).status === 401);
  check(
    "旧的仅密码登录被拒绝",
    (await req("POST", "/auth/login", { password: "role-admin-test" }))
      .status === 401,
  );
  check(
    "错误账号被拒绝",
    (
      await req("POST", "/auth/login", {
        username: "admin",
        password: "role-admin-test",
      })
    ).status === 401,
  );
  check(
    "创作者不能使用管理员密码",
    (
      await req("POST", "/auth/login", {
        username: "cyberclubcreator",
        password: "role-admin-test",
      })
    ).status === 401,
  );
  const admin = await login("cyberclubadmin", "role-admin-test"),
    creator = await login("cyberclubcreator", "role-creator-test");
  // Verify generated accounts persist a password hash, never a plaintext credential.
  const { config } = await import("../server/src/config.ts");
  const { ensureCreatorAccount, authenticate } =
    await import("../server/src/core/auth.ts");
  const envPassword = config.creatorPassword;
  config.creatorPassword = "";
  const generated = ensureCreatorAccount();
  const credentials = fs.readFileSync(
    path.join(repo, ".git/cms-private/creator.json"),
    "utf8",
  );
  check(
    "自动创建独立强密码账号",
    generated.length >= 24 &&
      authenticate("cyberclubcreator", generated)?.role === "creator",
  );
  check(
    "创作者密码仅保存哈希且重启不重置",
    !credentials.includes(generated) &&
      ensureCreatorAccount() === "" &&
      authenticate("cyberclubcreator", generated)?.username ===
        "cyberclubcreator",
  );
  check(
    "凭据文件仅账户所有者可读",
    (fs.statSync(path.join(repo, ".git/cms-private/creator.json")).mode &
      0o777) ===
      0o600,
  );
  config.creatorPassword = envPassword;
  token = creator;
  check(
    "身份接口返回创作者",
    (await req("GET", "/auth/me")).data.role === "creator",
  );
  check(
    "拼接 token 被拒绝",
    (await req("GET", "/auth/me", undefined, creator + ".extra")).status ===
      401,
  );
  const forged = creator.split(".");
  const value = JSON.parse(Buffer.from(forged[0], "base64url").toString());
  value.role = "admin";
  forged[0] = Buffer.from(JSON.stringify(value)).toString("base64url");
  check(
    "篡改角色被拒绝",
    (await req("GET", "/auth/me", undefined, forged.join("."))).status === 401,
  );
  const legacyPayload = Buffer.from(
    JSON.stringify({ role: "admin", exp: Date.now() + 60000 }),
  ).toString("base64url");
  const legacy =
    legacyPayload +
    "." +
    createHmac("sha256", process.env.CMS_SESSION_SECRET)
      .update(legacyPayload)
      .digest("base64url");
  check(
    "旧无账号会话失效",
    (await req("GET", "/auth/me", undefined, legacy)).status === 401,
  );
  for (const [method, url, data] of [
    ["POST", "/publish", {}],
    ["GET", "/git/status"],
    ["GET", "/posts"],
    ["GET", "/posts/existing"],
    ["POST", "/posts", content()],
    ["PUT", "/posts/existing", { data: { draft: true } }],
    ["DELETE", "/posts/existing", {}],
    ["POST", "/dynamic", content()],
    ["POST", "/projects", content()],
    ["POST", "/spec", content()],
    ["POST", "/posts/existing/images", {}],
    ["DELETE", "/posts/existing/images/file.png", {}],
    ["GET", "/ai/settings"],
    ["PUT", "/ai/settings", {}],
    ["GET", "/ai/usage"],
    ["POST", "/ai/actions/unknown/apply", {}],
    ["POST", "/ai/daily/run", {}],
    ["PATCH", "/posts/existing", {}],
    ["POST", "/collections", {}],
  ])
    check(
      `创作者禁止 ${method} ${url}`,
      (await req(method, url, data)).status === 403,
    );
  for (const url of ["/meta", "/series", "/templates"])
    check(`创作者可读取 ${url}`, (await req("GET", url)).status === 200);
  check(
    "创作者 AI 工作台可读取个人状态",
    (await req("GET", "/ai/status")).status === 200,
  );
  check(
    "创作者可读取个人 AI 操作历史",
    (await req("GET", "/ai/history")).status === 200,
  );
  const initialHead = git(["rev-parse", "HEAD"]);
  const create = content();
  create.owner = "cyberclubadmin";
  create.status = "approved";
  let r = await req("POST", "/drafts", create);
  check(
    "创建私有草稿并忽略伪造归属状态",
    r.status === 201 &&
      r.data.owner === "cyberclubcreator" &&
      r.data.status === "draft",
  );
  let draft = r.data,
    id = draft.id;
  check(
    "客户端不能设置隐藏或置顶",
    draft.data.draft === undefined && draft.data.pinned === undefined,
  );
  check(
    "草稿没有进入博客内容",
    !fs.existsSync(path.join(repo, "src/content/posts/creator-first.md")) &&
      git(["rev-parse", "HEAD"]) === initialHead &&
      git(["status", "--porcelain"]) === "",
  );
  check(
    "稿件私有文件权限",
    (fs.statSync(path.join(repo, ".git/cms-private/drafts", id + ".json"))
      .mode &
      0o777) ===
      0o600,
  );
  check(
    "非法板块被拒绝",
    (await req("POST", "/drafts", { ...content(), collection: "new-board" }))
      .status === 422,
  );
  check(
    "创作者不能新建分类",
    (
      await req("POST", "/drafts", {
        ...content(),
        data: { ...content().data, category: "新板块" },
      })
    ).status === 403,
  );
  check(
    "创作者不能新建系列",
    (
      await req("POST", "/drafts", {
        ...content(),
        data: { ...content().data, series: "新系列" },
      })
    ).status === 403,
  );
  let own = await req("POST", "/drafts", content("admin-private"), admin);
  check("管理员可建私有稿件", own.status === 201);
  check(
    "列表不泄露其他用户稿件",
    !(await req("GET", "/drafts")).data.items.some((d) => d.id === own.data.id),
  );
  check(
    "不能读取他人稿件",
    (await req("GET", `/drafts/${own.data.id}`)).status === 404,
  );
  check(
    "不能修改他人稿件",
    (await req("PUT", `/drafts/${own.data.id}`, { ...content(), revision: 1 }))
      .status === 404,
  );
  check(
    "不能提交他人稿件",
    (await req("POST", `/drafts/${own.data.id}/submit`, { revision: 1 }))
      .status === 404,
  );
  check(
    "过期草稿版本被拒绝",
    (await req("PUT", `/drafts/${id}`, { ...content(), revision: 2 }))
      .status === 409,
  );
  r = await req("PUT", `/drafts/${id}`, {
    ...content(),
    body: "# 修改后的正文",
    revision: draft.revision,
  });
  check("本人可更新草稿", r.status === 200);
  draft = r.data;
  r = await req("POST", `/drafts/${id}/submit`, { revision: draft.revision });
  check("提交进入待发布状态", r.status === 200 && r.data.status === "pending");
  draft = r.data;
  check(
    "待发布稿件没有进入博客",
    !fs.existsSync(path.join(repo, "src/content/posts/creator-first.md")),
  );
  check(
    "待发布稿件锁定",
    (
      await req("PUT", `/drafts/${id}`, {
        ...content(),
        revision: draft.revision,
      })
    ).status === 409,
  );
  check(
    "创作者不能审核通过",
    (await req("POST", `/drafts/${id}/approve`, { revision: draft.revision }))
      .status === 403,
  );
  check(
    "创作者不能退回",
    (
      await req("POST", `/drafts/${id}/return`, {
        revision: draft.revision,
        note: "绕过审核",
      })
    ).status === 403,
  );
  check(
    "创作者不能删除草稿",
    (await req("DELETE", `/drafts/${id}`, {})).status === 403,
  );
  check(
    "管理员退回须填原因",
    (
      await req(
        "POST",
        `/drafts/${id}/return`,
        { revision: draft.revision, note: "" },
        admin,
      )
    ).status === 422,
  );
  r = await req(
    "POST",
    `/drafts/${id}/return`,
    { revision: draft.revision, note: "请补充资料" },
    admin,
  );
  check(
    "管理员可退回修改",
    r.status === 200 &&
      r.data.status === "draft" &&
      r.data.reviewNote === "请补充资料",
  );
  draft = r.data;
  check(
    "创作者能看到退回原因",
    (await req("GET", `/drafts/${id}`)).data.reviewNote === "请补充资料",
  );
  r = await req("PUT", `/drafts/${id}`, {
    ...content(),
    body: "# 补充资料后的正文",
    revision: draft.revision,
  });
  draft = r.data;
  r = await req("POST", `/drafts/${id}/submit`, { revision: draft.revision });
  draft = r.data;
  r = await req(
    "POST",
    `/drafts/${id}/approve`,
    { revision: draft.revision },
    admin,
  );
  check(
    "管理员审核通过并创建提交",
    r.status === 200 && r.data.status === "approved" && r.data.committed,
  );
  draft = r.data;
  check(
    "审核后正文正确且可发布",
    fs
      .readFileSync(
        path.join(repo, "src/content/posts/creator-first.md"),
        "utf8",
      )
      .includes("补充资料后的正文") &&
      (await req("GET", "/posts/creator-first", undefined, admin)).data.data
        .draft === false,
  );
  check("审核不会自动推送", git(["rev-parse", "origin/main"]) === initialHead);
  check(
    "重复审核不能重复写入",
    (
      await req(
        "POST",
        `/drafts/${id}/approve`,
        { revision: draft.revision },
        admin,
      )
    ).status === 409,
  );
  check(
    "审核通过不能再修改",
    (
      await req("PUT", `/drafts/${id}`, {
        ...content(),
        revision: draft.revision,
      })
    ).status === 409,
  );
  check(
    "管理员统一推送成功",
    (await req("POST", "/publish", {}, admin)).status === 200,
  );
  check(
    "私有稿件不进入 Git",
    !git(["ls-tree", "-r", "--name-only", "HEAD"]).includes("cms-private"),
  );
  // Non-post collections have no reliable blog draft flag; they must be equally isolated.
  for (const collection of ["dynamic", "projects", "spec"]) {
    let d = (
      await req("POST", "/drafts", content(`creator-${collection}`, collection))
    ).data;
    check(
      `${collection} 私有草稿隔离`,
      d.status === "draft" &&
        !fs.existsSync(
          path.join(repo, `src/content/${collection}/creator-${collection}.md`),
        ),
    );
    d = (await req("POST", `/drafts/${d.id}/submit`, { revision: d.revision }))
      .data;
    const reviewed = await req(
      "POST",
      `/drafts/${d.id}/approve`,
      { revision: d.revision },
      admin,
    );
    check(
      `${collection} 审核后才能写入`,
      reviewed.status === 200 &&
        fs.existsSync(
          path.join(repo, `src/content/${collection}/creator-${collection}.md`),
        ),
    );
  }
  // A collision never overwrites existing live content or consumes the submission.
  let collision = (await req("POST", "/drafts", content("existing"))).data;
  collision = (
    await req("POST", `/drafts/${collision.id}/submit`, {
      revision: collision.revision,
    })
  ).data;
  check(
    "审核拒绝覆盖现有文章",
    (
      await req(
        "POST",
        `/drafts/${collision.id}/approve`,
        { revision: collision.revision },
        admin,
      )
    ).status === 409 &&
      fs
        .readFileSync(path.join(repo, "src/content/posts/existing.md"), "utf8")
        .includes("Existing content"),
  );
  check(
    "冲突稿件仍可退回",
    (
      await req(
        "POST",
        `/drafts/${collision.id}/return`,
        { revision: collision.revision, note: "请更换文件标识" },
        admin,
      )
    ).status === 200,
  );
  const deleteCandidate = (
    await req("GET", `/drafts/${collision.id}`, undefined, admin)
  ).data;
  check(
    "管理员可删除投稿记录",
    (
      await req(
        "DELETE",
        `/drafts/${collision.id}`,
        { revision: deleteCandidate.revision },
        admin,
      )
    ).status === 200,
  );
  check(
    "已删除投稿不可读取",
    (await req("GET", `/drafts/${collision.id}`, undefined, admin)).status ===
      404,
  );
  // Two concurrent submissions with one revision must serialize to one success.
  let concurrent = (await req("POST", "/drafts", content("concurrent"))).data;
  const race = await Promise.all([
    req("POST", `/drafts/${concurrent.id}/submit`, {
      revision: concurrent.revision,
    }),
    req("POST", `/drafts/${concurrent.id}/submit`, {
      revision: concurrent.revision,
    }),
  ]);
  check(
    "并发提交只有一次成功",
    race.filter((r) => r.status === 200).length === 1 &&
      race.filter((r) => r.status === 409).length === 1,
  );
  token = admin;
  const existing = (await req("GET", "/posts/existing")).data;
  check(
    "管理员仍可隐藏文章",
    (
      await req("PUT", "/posts/existing", {
        expected: existing.version,
        data: { draft: true },
      })
    ).status === 200,
  );
  const hidden = (await req("GET", "/posts/existing")).data;
  check(
    "管理员仍可删除文章",
    (await req("DELETE", "/posts/existing", { expected: hidden.version }))
      .status === 200,
  );
  console.log(`权限与审核回归：${passed} 项通过`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(0);
} catch (e) {
  console.error(e);
  console.error("保留测试现场：", root);
  process.exit(1);
}
