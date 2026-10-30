import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ApiError } from "../core/errors.ts";
import { listCollection, getOne } from "../core/content-store.ts";
import { schemas, type CollectionName } from "../core/schemas.ts";
import { isValidSlug } from "../core/slugify.ts";
import { status } from "../core/publisher.ts";
import { settingsPath } from "./settings.ts";
import { templates } from "../core/templates.ts";
const collection = z.enum(["posts", "dynamic", "projects", "spec"]);
const secret = /password|secret|token|api.?key|credential/i;
export function safeData(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !secret.test(key)),
  );
}
const inputSchema = z
  .object({
    operation: z.enum(["create", "update", "delete", "publish"]),
    collection: collection.optional(),
    slug: z.string().max(180).optional(),
    data: z.record(z.unknown()).optional(),
    body: z.string().max(120000).optional(),
    reason: z.string().max(600).optional(),
  })
  .strict();
export interface Proposal {
  id: string;
  operation: string;
  collection?: CollectionName;
  slug?: string;
  reason: string;
  data?: Record<string, unknown>;
  body?: string;
  before?: { data: Record<string, unknown>; body: string };
  expiresAt: string;
  state: "pending" | "running" | "done" | "failed";
  result?: unknown;
  version?: { head: string; fileMtimeMs: number };
  fingerprint?: string;
  head?: string;
}
const proposals = new Map<string, Proposal>();
const fingerprint = (p: {
  data: unknown;
  extraFields: unknown;
  body: string;
}) =>
  createHash("sha256")
    .update(JSON.stringify([p.data, p.extraFields, p.body]))
    .digest("hex");
export function publicProposal(p: Proposal) {
  const { version, fingerprint, head, ...publicPart } = p;
  return publicPart;
}
export async function propose(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(422, "AI_ACTION_INVALID", "操作参数不符合约定");
  const r = parsed.data;
  const p: Proposal = {
    id: crypto.randomUUID(),
    operation: r.operation,
    collection: r.collection,
    slug: r.slug,
    reason: r.reason ?? "",
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    state: "pending",
  };
  if (r.operation === "publish") {
    const st = await status();
    if (!st.healthy || !st.clean)
      throw new ApiError(
        409,
        "AI_PUBLISH_BLOCKED",
        "仓库状态异常或尚有未提交修改，不能准备发布",
      );
    p.head = st.head;
    p.reason =
      r.reason || `推送当前 ${st.pendingPushCount} 个提交，触发博客构建`;
  } else {
    if (!r.collection || !r.slug || !isValidSlug(r.slug))
      throw new ApiError(
        422,
        "AI_ACTION_INVALID",
        "请指定板块和有效的文件标识",
      );
    if (Object.keys(r.data ?? {}).some((key) => secret.test(key)))
      throw new ApiError(
        422,
        "AI_SECRET_FIELD",
        "AI 操作不修改密码或密钥，请在对应表单设置",
      );
    let current: Awaited<ReturnType<typeof getOne>> | undefined;
    if (r.operation !== "create") {
      current = await getOne(r.collection, r.slug);
      p.before = {
        data: safeData({ ...current.extraFields, ...current.data }),
        body: current.body,
      };
      p.version = current.version;
      p.fingerprint = fingerprint(current);
    } else {
      try {
        await getOne(r.collection, r.slug);
        throw new ApiError(409, "CONFLICT", "文件标识已存在");
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    if (r.operation !== "delete") {
      const data = r.data ?? {};
      if (r.collection === "projects" && Array.isArray(data.link)) {
        data.link = data.link.map((entry: any) => {
          const icon = String(entry.icon ?? "").replace(/^fa6-/, "fa7-");
          const normalized = icon === "github" ? "fa7-brands:github" : icon;
          if (
            normalized.includes(":") &&
            !/^(?:https?:|fa7-brands:|fa7-solid:|fa7-regular:|material-symbols:|simple-icons:|mdi:|mingcute:)/.test(
              normalized,
            )
          )
            throw new ApiError(
              422,
              "AI_ICON_INVALID",
              "成员图标使用了博客未安装的图标集合",
            );
          return { ...entry, icon: normalized };
        });
      }
      if (
        r.operation === "create" &&
        (r.collection === "posts" || r.collection === "projects") &&
        !("draft" in data)
      )
        data.draft = true;
      const merged = { ...(current?.data ?? {}), ...data };
      for (const [key, value] of Object.entries(merged))
        if (value === null) delete merged[key];
      const checked = schemas[r.collection].safeParse(merged);
      if (!checked.success)
        throw new ApiError(
          422,
          "AI_CONTENT_INVALID",
          checked.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("；"),
        );
      if (r.collection !== "spec") {
        const shape = (schemas[r.collection] as any).shape;
        if (Object.keys(data).some((key) => !(key in shape)))
          throw new ApiError(
            422,
            "AI_UNKNOWN_FIELD",
            "操作含未知字段，请按板块字段设置",
          );
      }
      p.data =
        r.operation === "create"
          ? (checked.data as Record<string, unknown>)
          : data;
      p.body = r.body;
    }
  }
  for (const [id, value] of proposals)
    if (Date.parse(value.expiresAt) < Date.now()) proposals.delete(id);
  if (proposals.size >= 100)
    throw new ApiError(
      429,
      "AI_ACTION_LIMIT",
      "待确认操作过多，请完成已有操作后再试",
    );
  proposals.set(p.id, p);
  return publicProposal(p);
}
const auditPath = path.join(
  path.dirname(settingsPath),
  ".runtime/ai-actions.jsonl",
);
async function audit(p: Proposal, ok: boolean) {
  await fs.mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  await fs.appendFile(
    auditPath,
    JSON.stringify({
      id: p.id,
      time: new Date().toISOString(),
      operation: p.operation,
      collection: p.collection,
      slug: p.slug,
      ok,
    }) + "\n",
    { mode: 0o600 },
  );
}
export async function history() {
  try {
    const content = await fs.readFile(auditPath, "utf8");
    return content
      .trim()
      .split("\n")
      .slice(-50)
      .reverse()
      .map((line) => JSON.parse(line));
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw new ApiError(500, "AI_AUDIT_READ", "操作记录读取失败");
  }
}
export async function apply(
  id: string,
  run: (
    method: string,
    url: string,
    body: unknown,
  ) => Promise<{ status: number; data: any }>,
) {
  const p = proposals.get(id);
  if (!p)
    throw new ApiError(
      404,
      "AI_ACTION_MISSING",
      "操作不存在或服务已重启，请重新生成",
    );
  if (p.state === "done") return p.result;
  if (p.state !== "pending")
    throw new ApiError(
      409,
      "AI_ACTION_STATE",
      "操作已在执行或失效，请刷新后重新准备",
    );
  if (Date.parse(p.expiresAt) < Date.now())
    throw new ApiError(
      409,
      "AI_ACTION_EXPIRED",
      "操作已超过 15 分钟，请重新生成并核对",
    );
  p.state = "running";
  try {
    let expected = p.version;
    if (p.operation === "publish") {
      const st = await status();
      if (st.head !== p.head)
        throw new ApiError(
          409,
          "AI_ACTION_STALE",
          "待发布提交已有变化，请重新检查并准备发布",
        );
    } else if (p.operation !== "create") {
      const current = await getOne(p.collection!, p.slug!);
      if (fingerprint(current) !== p.fingerprint)
        throw new ApiError(
          409,
          "AI_ACTION_STALE",
          "内容已被修改，请重新生成操作预览",
        );
      expected = current.version;
    }
    const base = `/${p.collection}`;
    const payload =
      p.operation === "create"
        ? { slug: p.slug, data: p.data, body: p.body ?? "", commit: true }
        : p.operation === "update"
          ? { data: p.data, body: p.body, expected, commit: true }
          : p.operation === "delete"
            ? { expected }
            : {};
    const r = await run(
      p.operation === "update"
        ? "PUT"
        : p.operation === "delete"
          ? "DELETE"
          : "POST",
      p.operation === "publish"
        ? "/publish"
        : p.operation === "create"
          ? base
          : `${base}/${p.slug}`,
      payload,
    );
    if (r.status >= 400)
      throw new ApiError(
        r.status,
        r.data?.error?.code ?? "AI_ACTION_FAILED",
        r.data?.error?.message ?? "执行失败",
      );
    p.result = r.data;
    p.state = "done";
    await audit(p, true).catch(() => {});
    return r.data;
  } catch (e) {
    p.state = "failed";
    await audit(p, false).catch(() => {});
    throw e;
  }
}
export async function readTool(name: string, args: unknown) {
  if (name === "list_content") {
    const q = z
      .object({
        collection,
        keyword: z.string().max(200).optional(),
        draft: z.boolean().optional(),
      })
      .parse(args);
    let rows = await listCollection(q.collection);
    if (q.keyword)
      rows = rows.filter((p) =>
        `${p.slug} ${p.data.title ?? p.extraFields.title ?? ""} ${p.data.description ?? ""}`
          .toLowerCase()
          .includes(q.keyword!.toLowerCase()),
      );
    if (q.draft !== undefined)
      rows = rows.filter((p) => !!p.data.draft === q.draft);
    return {
      total: rows.length,
      items: rows.slice(0, 50).map((p) => ({
        slug: p.slug,
        ...safeData(p.data),
        title: p.data.title ?? p.extraFields.title ?? p.slug,
        passwordProtected: !!p.data.password,
      })),
    };
  }
  if (name === "get_content") {
    const q = z.object({ collection, slug: z.string().max(180) }).parse(args);
    const p = await getOne(q.collection, q.slug);
    return {
      slug: p.slug,
      data: safeData({ ...p.extraFields, ...p.data }),
      body: p.body.slice(0, 50000),
      truncated: p.body.length > 50000,
    };
  }
  if (name === "get_site_status") return status();
  if (name === "get_templates") return templates;
  throw new ApiError(422, "AI_UNKNOWN_TOOL", "不支持的 AI 操作");
}
const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
const col = { type: "string", enum: ["posts", "dynamic", "projects", "spec"] };
export const tools = [
  fn(
    "list_content",
    "搜索或列出文章 posts、动态 dynamic、成员 projects、页面 spec 的元数据；不修改内容",
    {
      collection: col,
      keyword: { type: "string" },
      draft: { type: "boolean" },
    },
    ["collection"],
  ),
  fn(
    "get_content",
    "读取指定内容的正文和基础设置；修改前请先读取",
    { collection: col, slug: { type: "string" } },
    ["collection", "slug"],
  ),
  fn("get_site_status", "读取仓库分支和待发布状态", {}),
  fn("get_templates", "读取可用 Markdown 模板", {}),
  fn(
    "propose_change",
    "准备创建、更新、删除或发布操作。仅生成预览，等待管理员确认；不自动执行。更新时 data 只传修改字段；不得处理密码或密钥。",
    {
      operation: {
        type: "string",
        enum: ["create", "update", "delete", "publish"],
      },
      collection: col,
      slug: { type: "string" },
      data: { type: "object", additionalProperties: true },
      body: { type: "string" },
      reason: { type: "string" },
    },
    ["operation"],
  ),
];
