import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../core/errors.ts";
import { actorKey, requestIdentity } from "../core/request-context.ts";
import { validateDraftInput } from "../routes/drafts.ts";
import { safeData } from "./actions.ts";
import { templates } from "../core/templates.ts";
import { settingsPath } from "./settings.ts";

type Run = (
  method: string,
  url: string,
  body?: unknown,
) => Promise<{ status: number; data: any }>;
const collection = z.enum(["posts", "dynamic", "projects", "spec"]);
const schema = z
  .object({
    operation: z.enum(["create", "update", "submit"]),
    collection: collection.optional(),
    draftId: z.string().uuid().optional(),
    slug: z.string().max(150).optional(),
    data: z.record(z.unknown()).optional(),
    body: z.string().max(120000).optional(),
    reason: z.string().max(600).optional(),
  })
  .strict();
interface Proposal {
  id: string;
  owner: string;
  scope: "draft";
  operation: "create" | "update" | "submit";
  collection: string;
  slug: string;
  draftId?: string;
  revision?: number;
  data?: Record<string, unknown>;
  body?: string;
  before?: { data: Record<string, unknown>; body: string };
  reason: string;
  expiresAt: string;
  state: "pending" | "running" | "done" | "failed";
  result?: any;
}
const proposals = new Map<string, Proposal>();
function publicProposal(p: Proposal) {
  const { owner, revision, result, ...safe } = p;
  return safe;
}
async function call(run: Run, method: string, url: string, body?: unknown) {
  const r = await run(method, url, body);
  if (r.status >= 400)
    throw new ApiError(
      r.status,
      r.data?.error?.code ?? "AI_ACTION_FAILED",
      r.data?.error?.message ?? "草稿操作失败",
    );
  return r.data;
}
export async function creatorPropose(raw: unknown, run: Run) {
  const checked = schema.safeParse(raw);
  if (!checked.success)
    throw new ApiError(
      403,
      "FORBIDDEN",
      "创作者 AI 只能新建、修改自己的草稿或提交审核",
    );
  const q = checked.data,
    user = requestIdentity.getStore();
  if (!user || user.role !== "creator")
    throw new ApiError(403, "FORBIDDEN", "缺少创作者身份");
  if (
    Object.keys(q.data ?? {}).some((k) =>
      /password|secret|token|api.?key|credential|draft|pinned/i.test(k),
    )
  )
    throw new ApiError(
      403,
      "FORBIDDEN",
      "AI 不能设置密码、隐藏、置顶或权限字段",
    );
  const current =
    q.operation === "create"
      ? null
      : q.draftId
        ? await call(run, "GET", `/drafts/${q.draftId}`)
        : null;
  if (q.operation !== "create" && !current)
    throw new ApiError(
      422,
      "AI_ACTION_INVALID",
      "请先查询并提供自己的草稿编号 draftId",
    );
  if (current && current.status !== "draft")
    throw new ApiError(409, "CONFLICT", "稿件已提交或审核通过，不能修改");
  if (q.operation === "submit" && !current.body.trim())
    throw new ApiError(422, "VALIDATION_FAILED", "请先填写正文");
  const content =
    q.operation === "submit"
      ? null
      : await validateDraftInput(
          {
            collection: q.collection ?? current?.collection,
            slug: q.slug ?? current?.slug,
            data: { ...current?.data, ...q.data },
            body: q.body ?? current?.body ?? "",
          },
          user,
        );
  if (content && current && content.collection !== current.collection)
    throw new ApiError(403, "FORBIDDEN", "不能切换稿件板块");
  for (const [id, p] of proposals)
    if (Date.parse(p.expiresAt) < Date.now()) proposals.delete(id);
  if (
    [...proposals.values()].filter((p) => p.owner === actorKey()).length >=
      30 ||
    proposals.size >= 500
  )
    throw new ApiError(
      429,
      "AI_ACTION_LIMIT",
      "待确认操作过多，请先处理已有操作",
    );
  const p: Proposal = {
    id: randomUUID(),
    owner: actorKey(),
    scope: "draft",
    operation: q.operation,
    collection: content?.collection ?? current.collection,
    slug: content?.slug ?? current.slug,
    draftId: current?.id,
    revision: current?.revision,
    data: content?.data,
    body: content?.body,
    before: current
      ? { data: safeData(current.data), body: current.body }
      : undefined,
    reason: q.reason ?? "",
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    state: "pending",
  };
  proposals.set(p.id, p);
  return publicProposal(p);
}
export async function creatorApply(id: string, run: Run) {
  const p = proposals.get(id);
  if (!p || p.owner !== actorKey())
    throw new ApiError(404, "AI_ACTION_MISSING", "操作不存在或不属于当前账号");
  if (p.state === "done") return p.result;
  if (p.state !== "pending" || Date.parse(p.expiresAt) <= Date.now())
    throw new ApiError(409, "AI_ACTION_STATE", "操作已执行、失效或正在执行");
  p.state = "running";
  try {
    const result = await call(
      run,
      p.operation === "update" ? "PUT" : "POST",
      p.operation === "create"
        ? "/drafts"
        : `/drafts/${p.draftId}${p.operation === "submit" ? "/submit" : ""}`,
      p.operation === "submit"
        ? { revision: p.revision }
        : {
            collection: p.collection,
            slug: p.slug,
            data: p.data,
            body: p.body,
            revision: p.revision,
          },
    );
    p.state = "done";
    p.result = result;
    p.draftId = result.id;
    const directory = path.join(path.dirname(settingsPath), ".runtime");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs
      .appendFile(
        path.join(directory, "ai-actions.jsonl"),
        JSON.stringify({
          id: p.id,
          time: new Date().toISOString(),
          actor: p.owner,
          username: requestIdentity.getStore()?.username,
          scope: "draft",
          operation: p.operation,
          collection: p.collection,
          slug: p.slug,
          ok: true,
        }) + "\n",
        { mode: 0o600 },
      )
      .catch(() => {});
    return result;
  } catch (e) {
    p.state = "failed";
    throw e;
  }
}
export async function creatorReadTool(name: string, raw: unknown, run: Run) {
  if (name === "get_templates") return templates;
  if (name === "get_content_options")
    return {
      meta: await call(run, "GET", "/meta"),
      series: await call(run, "GET", "/series"),
    };
  if (name === "list_content") {
    const q = z
      .object({
        collection: collection.optional(),
        keyword: z.string().max(200).optional(),
      })
      .strict()
      .parse(raw);
    const { items } = await call(run, "GET", "/drafts");
    return {
      items: items
        .filter(
          (d: any) =>
            (!q.collection || d.collection === q.collection) &&
            (!q.keyword ||
              `${d.slug} ${d.data.title ?? ""}`.includes(q.keyword)),
        )
        .slice(0, 50),
    };
  }
  if (name === "get_content") {
    const q = z.object({ draftId: z.string().uuid() }).strict().parse(raw);
    const d = await call(run, "GET", `/drafts/${q.draftId}`);
    return {
      id: d.id,
      collection: d.collection,
      slug: d.slug,
      status: d.status,
      data: safeData(d.data),
      body: d.body.slice(0, 50000),
      truncated: d.body.length > 50000,
    };
  }
  throw new ApiError(
    403,
    "FORBIDDEN",
    "此 AI 工具仅限管理员，创作者只能操作自己的草稿",
  );
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
export const creatorTools = [
  fn(
    "list_content",
    "列出或搜索当前创作者自己的私有草稿，返回 id 供读取和修改",
    { collection: col, keyword: { type: "string" } },
  ),
  fn(
    "get_content",
    "读取当前创作者自己的稿件，修改和提交前必须先读取",
    { draftId: { type: "string" } },
    ["draftId"],
  ),
  fn(
    "get_content_options",
    "读取现有分类、系列和板块字段；创作者不能新建分类或系列",
    {},
  ),
  fn("get_templates", "读取 Markdown 创作模板", {}),
  fn(
    "propose_change",
    "准备新建/修改私有草稿或提交管理员审核的操作卡片，必须由用户确认，不能发布或删除",
    {
      operation: { type: "string", enum: ["create", "update", "submit"] },
      collection: col,
      draftId: { type: "string" },
      slug: { type: "string" },
      data: { type: "object", additionalProperties: true },
      body: { type: "string" },
      reason: { type: "string" },
    },
    ["operation"],
  ),
];
