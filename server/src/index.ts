import { daily } from "./ai/daily.ts";
import { createSession } from "./core/auth.ts";
import { propose, apply } from "./ai/actions.ts";
import { getOne } from "./core/content-store.ts";
import { ApiError } from "./core/errors.ts";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import fs from "node:fs";
import path from "node:path";
import { config, validateConfig } from "./config.ts";
import {
  authMiddleware,
  errorHandler,
  roleMiddleware,
  identityOf,
} from "./middleware.ts";
import { ensureCreatorAccount } from "./core/auth.ts";
import { draftRoutes } from "./routes/drafts.ts";
import { authRoutes } from "./routes/auth.ts";
import { collectionRoutes } from "./routes/collections.ts";
import { metaHandler, seriesHandler } from "./routes/meta.ts";
import { toolRoutes } from "./routes/tools.ts";
import { aiRoutes } from "./routes/ai.ts";
import { templates } from "./core/templates.ts";
import { gitRoutes } from "./routes/git.ts";

validateConfig();
const initialCreatorPassword = ensureCreatorAccount();
if (initialCreatorPassword)
  console.log(
    `[cms] 创作者账号 cyberclubcreator 初始密码（仅首次显示）: ${initialCreatorPassword}`,
  );

const app = new Hono();

// 统一错误结构
app.onError(errorHandler());

// 安全响应头（API 与静态资源通用）
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
});

const v1 = new Hono();
v1.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});

// 认证（login/logout 不需要认证）
v1.route("/auth", authRoutes);
// 认证中间件：之后注册的全部路由受保护
v1.use("*", authMiddleware());
v1.use("*", roleMiddleware());
// Serialize content mutations and Git operations in this single-process service.
let mutationTail = Promise.resolve();
v1.use("*", async (c, next) => {
  if (
    !["POST", "PUT", "DELETE"].includes(c.req.method) ||
    c.req.path.startsWith("/api/v1/ai/")
  )
    return next();
  const previous = mutationTail;
  let release!: () => void;
  mutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await next();
  } finally {
    release();
  }
});
// /me 必须在 authMiddleware 之后注册（受保护）
v1.get("/auth/me", (c) => c.json({ ...identityOf(c), expiresAt: null }));
v1.route("/drafts", draftRoutes);
v1.route("/posts", collectionRoutes("posts"));
v1.route("/dynamic", collectionRoutes("dynamic"));
v1.route("/projects", collectionRoutes("projects"));
v1.route("/spec", collectionRoutes("spec"));
// meta：/api/v1/meta 与 /api/v1/series
v1.get("/templates", (c) =>
  c.json({
    items: templates.filter(
      (t) =>
        !c.req.query("collection") ||
        t.collection === c.req.query("collection"),
    ),
  }),
);
v1.route(
  "/ai",
  aiRoutes(async (c, method, url, body) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    for (const key of ["Cookie", "Authorization"]) {
      const value = c.req.header(key);
      if (value) headers[key] = value;
    }
    const response = await app.request(`http://localhost/api/v1${url}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }),
);
v1.get("/meta", metaHandler);
v1.get("/series", seriesHandler);
// tools 平铺挂载（含 /slug-preview 与 /posts/:slug/images*）
v1.route("/", toolRoutes);
v1.route("/git", gitRoutes);
v1.post("/publish", async (c) => {
  const { publish } = await import("./core/publisher.ts");
  const result = await publish();
  return c.json({ ok: true, ...result, cloudflareBuildUrl: null });
});

app.route("/api/v1", v1);
app.all("/api/*", (c) =>
  c.json({ error: { code: "NOT_FOUND", message: "接口不存在" } }, 404),
);

// 前端静态托管（生产）
if (fs.existsSync(config.webDist)) {
  const indexHtml = path.join(config.webDist, "index.html");
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    let p = path.join(config.webDist, url.pathname);
    if (!p.startsWith(config.webDist)) p = config.webDist;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return c.body(fs.readFileSync(p) as any, 200, guessHeaders(p));
    }
    // SPA fallback
    return c.body(fs.readFileSync(indexHtml) as any, 200, {
      "Content-Type": "text/html; charset=utf-8",
    });
  });
  console.log(`[cms] 前端静态托管: ${config.webDist}`);
}

function guessHeaders(p: string): Record<string, string> {
  const ext = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
  };
  return { "Content-Type": map[ext] ?? "application/octet-stream" };
}

serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    console.log(
      `[cms] API 服务已启动: http://${config.host}:${info.port}/api/v1`,
    );
    console.log(`[cms] 管理仓库: ${config.repoPath}`);
  },
);

// Delegated automation is deliberately restricted to a single daily draft create.
// It reuses Agent proposals and the authenticated, serialized content API.
daily.setWriter(async (draft) => {
  try {
    await getOne("posts", draft.slug);
    return { existing: true };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
  }
  const p = await propose({
    operation: "create",
    collection: "posts",
    slug: draft.slug,
    data: draft.data,
    body: draft.body,
    reason: "管理员授权的 GitHub 每日 Top 5 草稿任务",
  });
  const token = createSession({
    username: config.adminUsername,
    role: "admin",
  }).token;
  return apply(p.id, async (method, url, body) => {
    if (method !== "POST" || url !== "/posts")
      throw new Error("Draft creation only");
    const response = await app.request(`http://localhost/api/v1${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(body as Record<string, unknown>),
        assets: draft.assets,
        githubRepos: draft.githubRepos,
      }),
    });
    return { status: response.status, data: await response.json() };
  });
});
if (process.env.CMS_DAILY_SCHEDULER !== "off") {
  const tick = () => {
    void daily
      .tick()
      .catch(() =>
        console.error("[cms:daily] scheduler failed; inspect daily status"),
      );
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  tick();
}
