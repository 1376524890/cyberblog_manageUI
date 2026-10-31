import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { privateDir } from "../core/auth.ts";
import { identityOf } from "../middleware.ts";
import { ApiError } from "../core/errors.ts";
import { schemas, type CollectionName } from "../core/schemas.ts";
import {
  listCollection,
  writePost,
  atomicWrite,
  deletePost,
} from "../core/content-store.ts";
import { assertDiskSpace } from "../core/storage.ts";
import { commitPaths } from "../core/publisher.ts";
import { isValidSlug } from "../core/slugify.ts";

interface Draft {
  id: string;
  owner: string;
  collection: CollectionName;
  slug: string;
  data: Record<string, unknown>;
  body: string;
  status: "draft" | "pending" | "approved";
  revision: number;
  createdAt: string;
  updatedAt: string;
  reviewNote: string;
  reviewedBy?: string;
}
const input = z.object({
  collection: z.enum(["posts", "dynamic", "projects", "spec"]),
  slug: z
    .string()
    .min(1)
    .max(150)
    .refine(isValidSlug, "文件标识仅支持小写字母、数字和短横线"),
  data: z.record(z.unknown()),
  body: z.string().max(500000).default(""),
});
const version = z.object({ revision: z.number().int().positive() });
const directory = () => path.join(privateDir(), "drafts");
function file(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new ApiError(404, "NOT_FOUND", "稿件不存在");
  return path.join(directory(), `${id}.json`);
}
async function read(id: string, c: any): Promise<Draft> {
  let draft: Draft;
  try {
    draft = JSON.parse(await fs.readFile(file(id), "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") throw new ApiError(404, "NOT_FOUND", "稿件不存在");
    throw e;
  }
  const user = identityOf(c);
  if (user.role !== "admin" && draft.owner !== user.username)
    throw new ApiError(404, "NOT_FOUND", "稿件不存在");
  return draft;
}
async function save(draft: Draft) {
  await assertDiskSpace(Buffer.byteLength(JSON.stringify(draft)));
  await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
  await atomicWrite(file(draft.id), JSON.stringify(draft));
  await fs.chmod(file(draft.id), 0o600);
}
async function payload(raw: unknown, c: any) {
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    throw new ApiError(422, "VALIDATION_FAILED", "请检查板块、文件标识和正文", {
      issues: parsed.error.issues,
    });
  const p = parsed.data;
  const checked = schemas[p.collection].safeParse(p.data);
  if (!checked.success)
    throw new ApiError(422, "VALIDATION_FAILED", "内容属性校验失败", {
      issues: checked.error.issues,
    });
  // Accept schema fields only. Ownership and review state never come from clients.
  p.data = checked.data;
  delete p.data.draft;
  delete p.data.pinned;
  if (identityOf(c).role === "creator" && p.collection === "posts") {
    const posts = await listCollection("posts");
    for (const key of ["category", "series"]) {
      const value = p.data[key];
      if (value && !posts.some((post) => post.data[key] === value))
        throw new ApiError(403, "FORBIDDEN", "创作者只能选择现有分类和系列");
    }
  }
  return p;
}
function current(d: Draft, revision: number) {
  if (d.revision !== revision)
    throw new ApiError(409, "CONFLICT", "稿件已更新，请刷新后重试");
}
function admin(c: any) {
  if (identityOf(c).role !== "admin")
    throw new ApiError(403, "FORBIDDEN", "审核仅限管理员");
}
async function revision(c: any) {
  const parsed = version.safeParse(await c.req.json());
  if (!parsed.success)
    throw new ApiError(422, "VALIDATION_FAILED", "缺少稿件版本");
  return parsed.data.revision;
}
function editable(d: Draft) {
  if (d.status !== "draft")
    throw new ApiError(409, "CONFLICT", "稿件已提交或审核通过，不能继续修改");
}
function stamp(d: Draft) {
  d.revision++;
  d.updatedAt = new Date().toISOString();
}

export const draftRoutes = new Hono()
  .use(
    "*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: { code: "BODY_LIMIT", message: "稿件超过 2MB" } }, 413),
    }),
  )
  .get("/", async (c) => {
    await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
    const user = identityOf(c);
    const items: Draft[] = [];
    for (const name of await fs.readdir(directory())) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const d: Draft = JSON.parse(
        await fs.readFile(path.join(directory(), name), "utf8"),
      );
      if (user.role === "admin" || d.owner === user.username) items.push(d);
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Lists omit the body and sensitive attributes.
    return c.json({
      items: items.map(({ body, data, ...d }) => ({
        ...d,
        data: { title: data.title },
      })),
    });
  })
  .post("/", async (c) => {
    const p = await payload(await c.req.json(), c);
    const now = new Date().toISOString();
    const d: Draft = {
      ...p,
      id: randomUUID(),
      owner: identityOf(c).username,
      status: "draft",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      reviewNote: "",
    };
    await save(d);
    return c.json(d, 201);
  })
  .get("/:id", async (c) => c.json(await read(c.req.param("id"), c)))
  .put("/:id", async (c) => {
    const d = await read(c.req.param("id"), c);
    const raw = await c.req.json();
    const v = version.safeParse(raw);
    if (!v.success)
      throw new ApiError(422, "VALIDATION_FAILED", "缺少稿件版本");
    current(d, v.data.revision);
    editable(d);
    const p = await payload(raw, c);
    if (p.collection !== d.collection)
      throw new ApiError(403, "FORBIDDEN", "稿件创建后不能切换板块");
    const next: Draft = { ...d, ...p };
    stamp(next);
    await save(next);
    return c.json(next);
  })
  .delete("/:id", async (c) => {
    admin(c);
    const d = await read(c.req.param("id"), c);
    current(d, await revision(c));
    await fs.rm(file(d.id));
    return c.json({ ok: true });
  })
  .post("/:id/submit", async (c) => {
    const d = await read(c.req.param("id"), c);
    current(d, await revision(c));
    editable(d);
    if (!d.body.trim())
      throw new ApiError(422, "VALIDATION_FAILED", "请先填写正文再提交审核");
    d.status = "pending";
    d.reviewNote = "";
    stamp(d);
    await save(d);
    return c.json(d);
  })
  .post("/:id/return", async (c) => {
    admin(c);
    const d = await read(c.req.param("id"), c);
    const parsed = version
      .extend({ note: z.string().trim().min(1).max(2000) })
      .safeParse(await c.req.json());
    if (!parsed.success)
      throw new ApiError(422, "VALIDATION_FAILED", "请填写退回原因和稿件版本");
    current(d, parsed.data.revision);
    if (d.status !== "pending")
      throw new ApiError(409, "CONFLICT", "只能退回待发布稿件");
    d.status = "draft";
    d.reviewNote = parsed.data.note;
    d.reviewedBy = identityOf(c).username;
    stamp(d);
    await save(d);
    return c.json(d);
  })
  .post("/:id/approve", async (c) => {
    admin(c);
    const d = await read(c.req.param("id"), c);
    current(d, await revision(c));
    if (d.status !== "pending")
      throw new ApiError(409, "CONFLICT", "只能审核待发布稿件");
    const data = { ...d.data };
    if (d.collection === "posts" || d.collection === "projects")
      data.draft = false;
    const parsed = schemas[d.collection].safeParse(data);
    if (!parsed.success)
      throw new ApiError(422, "VALIDATION_FAILED", "稿件属性无效，请退回修改");
    await assertDiskSpace(
      Buffer.byteLength(d.body) + Buffer.byteLength(JSON.stringify(d)) + 65536,
    );
    const post = await writePost(d.collection, {
      slug: d.slug,
      data: parsed.data,
      body: d.body,
    });
    let result;
    try {
      result = await commitPaths(
        [post.filePath],
        `feat(${d.collection}): approve ${d.slug}`,
      );
    } catch (e) {
      // A failed commit must leave a retryable submission and no unreviewed file.
      await deletePost(d.collection, d.slug);
      throw e;
    }
    d.status = "approved";
    d.reviewedBy = identityOf(c).username;
    stamp(d);
    await save(d);
    return c.json({ ...d, ...result });
  });
