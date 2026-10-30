import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { z } from "zod";
import { slugify, isValidSlug } from "../core/slugify.ts";
import {
  listCollection,
  getOne,
  checkVersion,
  writePost,
  updatePost,
  deletePost,
  dynamicSlug,
  getHead,
} from "../core/content-store.ts";
import {
  schemas,
  COLLECTION_DIRS,
  type CollectionName,
} from "../core/schemas.ts";
import { commitPaths, isValidCommitMessage } from "../core/publisher.ts";
import { ApiError } from "../core/errors.ts";
import { formatDate } from "../core/yaml.ts";

/**
 * 通用 collection 路由工厂：posts/dynamic/projects/spec 共用一套 CRUD 模式，
 * 集合差异通过 schema 与少量钩子处理。
 */

const versionSchema = z.object({
  head: z.string(),
  fileMtimeMs: z.number(),
});

const writeBodySchema = z.object({
  githubRepos: z
    .array(
      z
        .object({
          name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
          id: z.number().int().positive().optional(),
        })
        .strict(),
    )
    .max(5)
    .optional(),
  assets: z
    .array(
      z
        .object({
          name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}\.png$/),
          data: z
            .string()
            .max(2800000)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        })
        .strict(),
    )
    .max(5)
    .optional(),
  slug: z.string().optional(),
  data: z.record(z.unknown()),
  body: z.string().default(""),
  commit: z.boolean().default(true),
  commitMessage: z.string().optional(),
});

const updateBodySchema = z.object({
  data: z.record(z.unknown()),
  body: z.string().optional(),
  extraFields: z.record(z.unknown()).optional(),
  expected: versionSchema,
  commit: z.boolean().default(true),
  commitMessage: z.string().optional(),
});

function defaultCommitMessage(
  action: "add" | "update" | "remove",
  collection: CollectionName,
  slug: string,
): string {
  const scope = collection === "posts" ? "post" : collection;
  return `${action === "add" ? "feat" : action === "update" ? "feat" : "feat"}(${scope}): ${action} ${slug}`;
}

function resolveSlugOrThrow(slug: string) {
  if (
    !slug ||
    slug.includes("..") ||
    slug.includes("/") ||
    slug.includes("\\")
  ) {
    throw new ApiError(400, "BAD_REQUEST", "非法 slug");
  }
}

export function collectionRoutes(collection: CollectionName): Hono {
  const app = new Hono();

  // GET /:slug 列表（筛选+分页）
  app.get("/", async (c) => {
    const q = c.req.query();
    let items = await listCollection(collection);
    if (q.keyword) {
      const kw = q.keyword.toLowerCase();
      items = items.filter(
        (p) =>
          String(p.data.title ?? "")
            .toLowerCase()
            .includes(kw) ||
          String(p.data.description ?? "")
            .toLowerCase()
            .includes(kw) ||
          p.slug.toLowerCase().includes(kw),
      );
    }
    if (q.category)
      items = items.filter((p) => String(p.data.category ?? "") === q.category);
    if (q.location)
      items = items.filter((p) => String(p.data.location ?? "") === q.location);
    if (q.status)
      items = items.filter((p) => String(p.data.status ?? "") === q.status);
    if (q.series)
      items = items.filter((p) => String(p.data.series ?? "") === q.series);
    if (q.tag)
      items = items.filter(
        (p) =>
          Array.isArray(p.data.tags) &&
          (p.data.tags as string[]).includes(q.tag!),
      );
    if (q.draft !== undefined)
      items = items.filter(
        (p) => Boolean(p.data.draft) === (q.draft === "true"),
      );
    if (q.pinned !== undefined)
      items = items.filter(
        (p) => Boolean(p.data.pinned) === (q.pinned === "true"),
      );
    const sort = q.sort ?? "published_desc";
    if (sort === "order_desc")
      items.sort(
        (a, b) => Number(b.data.order ?? 0) - Number(a.data.order ?? 0),
      );
    if (sort === "title_asc")
      items.sort((a, b) =>
        String(a.data.title ?? "").localeCompare(String(b.data.title ?? "")),
      );
    if (sort === "published_desc")
      items.sort(
        (a, b) =>
          String(b.data.published ?? "").localeCompare(
            String(a.data.published ?? ""),
          ) || a.slug.localeCompare(b.slug),
      );
    if (sort === "published_asc")
      items.sort((a, b) =>
        String(a.data.published ?? "").localeCompare(
          String(b.data.published ?? ""),
        ),
      );

    const pagination = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .safeParse({ page: q.page, pageSize: q.pageSize });
    if (!pagination.success)
      throw new ApiError(
        422,
        "VALIDATION_FAILED",
        "分页参数必须为正整数，pageSize 最大 100",
      );
    const { page, pageSize } = pagination.data;
    const total = items.length;
    const slice = items.slice((page - 1) * pageSize, page * pageSize);
    return c.json({
      items: slice.map((p) => ({
        slug: p.slug,
        filePath: p.filePath,
        title: p.data.title ?? p.extraFields.title ?? "",
        published: p.data.published ?? null,
        updated: p.data.updated ?? null,
        description: p.data.description ?? "",
        category: p.data.category ?? null,
        tags: p.data.tags ?? [],
        series: p.data.series ?? "",
        seriesOrder: p.data.seriesOrder ?? null,
        draft: Boolean(p.data.draft),
        pinned: Boolean(p.data.pinned),
        image: p.data.image ?? "",
        status: p.data.status ?? "",
        location: p.data.location ?? "",
        order: p.data.order ?? null,
        linkCount: Array.isArray(p.data.link) ? p.data.link.length : 0,
        passwordProtected: Boolean(p.data.password),
        wordCount: (p.body.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) ?? []).length,
        version: p.version,
      })),
      pagination: { page, pageSize, total },
    });
  });

  // GET /:slug
  app.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    resolveSlugOrThrow(slug);
    const p = await getOne(collection, slug);
    const postUrl =
      collection === "posts"
        ? `/posts/${slug}/`
        : collection === "projects"
          ? `/projects/${slug}/`
          : null;
    return c.json({
      slug: p.slug,
      filePath: p.filePath,
      frontmatterRaw: p.frontmatterRaw,
      data: p.data,
      extraFields: p.extraFields,
      body: p.body,
      images: [],
      version: p.version,
      postUrl:
        collection === "spec"
          ? ((
              {
                about: "/about/",
                friends: "/friends/",
                guestbook: "/guestbook/",
              } as Record<string, string>
            )[slug] ?? null)
          : postUrl,
      editorMode: p.filePath.endsWith(".mdx") ? "plaintext" : "markdown",
    });
  });

  // POST /
  app.post(
    "/",
    bodyLimit({
      maxSize: 16 * 1024 * 1024,
      onError: (c) =>
        c.json(
          { error: { code: "BODY_LIMIT", message: "内容与附图总量超过限制" } },
          413,
        ),
    }),
    async (c) => {
      const checked = writeBodySchema.safeParse(await c.req.json());
      if (!checked.success)
        throw new ApiError(422, "VALIDATION_FAILED", "内容或附图参数无效", {
          issues: checked.error.issues.map((i) => ({
            field: i.path.join("."),
            issue: i.message,
          })),
        });
      const req = checked.data;
      validateCommit(req);
      let slug = req.slug ?? "";
      if (collection === "dynamic" && !slug) slug = dynamicSlug();
      resolveSlugOrThrow(slug);
      if (!isValidSlug(slug)) {
        throw new ApiError(422, "VALIDATION_FAILED", `slug 非法: ${slug}`);
      }
      let data = { ...req.data };
      const extra: Record<string, unknown> = {};
      if (collection === "posts" && req.githubRepos)
        extra.githubRepos = req.githubRepos;
      if (collection === "dynamic" && "title" in data) {
        extra.title = data.title;
        delete data.title;
      }
      // schema 校验（422 字段级）
      const parsed = schemas[collection].safeParse(data);
      if (!parsed.success) {
        throw new ApiError(422, "VALIDATION_FAILED", "front matter 校验失败", {
          issues: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            issue: i.message,
          })),
        });
      }
      const file = await writePost(collection, {
        slug,
        data: parsed.data as Record<string, unknown>,
        extraFields: extra,
        body: req.body,
        assets: req.assets,
      });
      let committed = false;
      let commitSha: string | null = null;
      let pendingPush = false;
      if (req.commit) {
        const msg =
          req.commitMessage ?? defaultCommitMessage("add", collection, slug);
        if (req.commitMessage && !isValidCommitMessage(req.commitMessage)) {
          throw new ApiError(
            422,
            "VALIDATION_FAILED",
            "commitMessage 不符合 Conventional Commits",
          );
        }
        const r = await commitPaths(
          [file.filePath, `${COLLECTION_DIRS[collection]}/images/${file.slug}`],
          msg,
        );
        committed = r.committed;
        commitSha = r.commitSha;
        pendingPush = r.pendingPush;
      }
      // commit 后 version.head 必须取新 HEAD，否则客户端下一次 PUT 会乐观锁误判
      const head = await getHead();
      return c.json(
        {
          slug: file.slug,
          filePath: file.filePath,
          version: { head, fileMtimeMs: file.version.fileMtimeMs },
          committed,
          commitSha,
          pendingPush,
        },
        201,
      );
    },
  );

  // PUT /:slug
  app.put("/:slug", async (c) => {
    const slug = c.req.param("slug");
    resolveSlugOrThrow(slug);
    const req = updateBodySchema.parse(await c.req.json());
    validateCommit(req);
    await checkVersion(collection, slug, req.expected);
    const existing = await getOne(collection, slug);
    // 部分更新语义：未传字段保持原值 → 合并后再整体校验
    const mergedInput: Record<string, unknown> = {
      ...existing.data,
      ...req.data,
    };
    for (const [k, v] of Object.entries(req.data)) {
      if (v === null) delete mergedInput[k];
    }
    const parsed = schemas[collection].safeParse(
      collection === "dynamic" ? stripDynamicTitle(mergedInput) : mergedInput,
    );
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_FAILED", "front matter 校验失败", {
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          issue: i.message,
        })),
      });
    }
    const file = await updatePost(collection, slug, {
      data: {
        ...mergedInput,
        ...Object.fromEntries(
          Object.entries(req.data).filter(([, v]) => v === null),
        ),
      },
      extraFields: req.extraFields,
      body: req.body ?? existing.body,
    });
    let committed = false;
    let commitSha: string | null = null;
    let pendingPush = false;
    if (req.commit) {
      const msg =
        req.commitMessage ?? defaultCommitMessage("update", collection, slug);
      if (req.commitMessage && !isValidCommitMessage(req.commitMessage)) {
        throw new ApiError(
          422,
          "VALIDATION_FAILED",
          "commitMessage 不符合 Conventional Commits",
        );
      }
      const r = await commitPaths(
        [file.filePath, `${COLLECTION_DIRS[collection]}/images/${file.slug}`],
        msg,
      );
      committed = r.committed;
      commitSha = r.commitSha;
      pendingPush = r.pendingPush;
    }
    const head = await getHead();
    return c.json({
      slug: file.slug,
      filePath: file.filePath,
      version: { head, fileMtimeMs: file.version.fileMtimeMs },
      committed,
      commitSha,
      pendingPush,
    });
  });

  // DELETE /:slug
  app.delete("/:slug", async (c) => {
    const slug = c.req.param("slug");
    resolveSlugOrThrow(slug);
    const body = await c.req.json().catch(() => ({}));
    const expected = versionSchema.parse(body.expected ?? {});
    await checkVersion(collection, slug, expected);
    const rel = await deletePost(
      collection,
      slug,
      c.req.query("alsoDeleteImages") === "true",
    );
    let committed = false;
    let pendingPush = false;
    const msg = defaultCommitMessage("remove", collection, slug);
    const r = await commitPaths([rel], msg);
    committed = r.committed;
    pendingPush = r.pendingPush;
    return c.json({ ok: true, committed, pendingPush });
  });

  return app;
}

function stripDynamicTitle(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const d = { ...data };
  if ("title" in d) delete d.title;
  return d;
}

export { slugify };

function validateCommit(req: { commit: boolean; commitMessage?: string }) {
  if (
    req.commit &&
    req.commitMessage &&
    !isValidCommitMessage(req.commitMessage)
  )
    throw new ApiError(
      422,
      "VALIDATION_FAILED",
      "commitMessage 不符合 Conventional Commits",
    );
}
