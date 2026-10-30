import { Hono } from "hono";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";
import { ApiError } from "../core/errors.ts";
import { slugify, isValidSlug } from "../core/slugify.ts";
import { COLLECTION_DIRS, type CollectionName } from "../core/schemas.ts";
import { getOne } from "../core/content-store.ts";

/** 平铺挂载在 v1 根的工具端点：/slug-preview、/posts/:slug/images* */

export const toolRoutes = new Hono()

  // POST /slug-preview
  .post("/slug-preview", async (c) => {
    const body = z
      .object({ title: z.string().optional(), filename: z.string().optional() })
      .parse(await c.req.json());
    const source = body.filename ?? body.title ?? "";
    if (!source.trim()) {
      throw new ApiError(422, "VALIDATION_FAILED", "title 或 filename 必填");
    }
    const slug = slugify(source);
    const dir = path.join(config.repoPath, "src/content/posts");
    let available = true;
    let conflict: string | null = null;
    for (const ext of [".md", ".mdx"]) {
      const p = path.join(dir, `${slug}${ext}`);
      if (fs.existsSync(p)) {
        available = false;
        conflict = `src/content/posts/${slug}${ext}`;
      }
    }
    return c.json({ slug, available, conflict });
  })

  // GET /posts/:slug/images
  .get("/:collection/:slug/images", async (c) => {
    const slug = c.req.param("slug");
    const collection = resolveCollection(c.req.param("collection"));
    await getOne(collection, slug); // 404 校验
    const dir = imagesDir(collection, slug);
    const images: { name: string; sizeKB: number; refPath: string }[] = [];
    if (fs.existsSync(dir)) {
      for (const name of await fs.promises.readdir(dir)) {
        if (name.startsWith(".")) continue;
        const st = await fs.promises.stat(path.join(dir, name));
        images.push({
          name,
          sizeKB: Math.round(st.size / 1024),
          refPath: `./images/${slug}/${name}`,
        });
      }
    }
    return c.json({ slug, images });
  })

  .get("/:collection/:slug/images/:filename", async (c) => {
    const slug = c.req.param("slug");
    const collection = resolveCollection(c.req.param("collection"));
    await getOne(collection, slug);
    const filename = c.req.param("filename");
    if (filename !== path.basename(filename) || filename.startsWith("."))
      throw new ApiError(400, "BAD_REQUEST", "非法图片名");
    const abs = path.join(imagesDir(collection, slug), filename);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile())
      throw new ApiError(404, "NOT_FOUND", "图片不存在");
    const types: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      avif: "image/avif",
      gif: "image/gif",
    };
    const type = types[path.extname(filename).slice(1).toLowerCase()];
    if (!type)
      throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "不支持的图片格式");
    return c.body(fs.readFileSync(abs) as any, 200, {
      "Content-Type": type,
      "Cache-Control": "private, no-store",
    });
  })

  // POST /posts/:slug/images
  .post("/:collection/:slug/images", async (c) => {
    const slug = c.req.param("slug");
    const collection = resolveCollection(c.req.param("collection"));
    await getOne(collection, slug);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "BAD_REQUEST", "缺少 file 字段");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "图片超过 5MB 限制");
    }
    const allowed = ["png", "jpg", "jpeg", "webp", "avif", "gif"];
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!allowed.includes(ext)) {
      throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", `不支持的格式: ${ext}`);
    }
    const dir = imagesDir(collection, slug);
    await fs.promises.mkdir(dir, { recursive: true });
    const safeName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const abs = path.join(dir, safeName);
    const buf = Buffer.from(await file.arrayBuffer());
    // sharp 压缩：长边 ≤1920px（gif 保持原样避免丢动画）
    const processed =
      ext === "gif"
        ? buf
        : await sharp(buf)
            .rotate()
            .resize({
              width: 1920,
              height: 1920,
              fit: "inside",
              withoutEnlargement: true,
            })
            .toBuffer();
    await fs.promises.writeFile(abs, processed);
    const sizeKB = Math.round(processed.byteLength / 1024);
    return c.json(
      { name: safeName, refPath: `./images/${slug}/${safeName}`, sizeKB },
      201,
    );
  })

  // DELETE /posts/:slug/images/:filename
  .delete("/:collection/:slug/images/:filename", async (c) => {
    const slug = c.req.param("slug");
    const collection = resolveCollection(c.req.param("collection"));
    const filename = c.req.param("filename");
    await getOne(collection, slug);
    const abs = path.join(imagesDir(collection, slug), path.basename(filename));
    if (!fs.existsSync(abs)) throw new ApiError(404, "NOT_FOUND", "图片不存在");
    await fs.promises.rm(abs);
    return c.json({ ok: true });
  });

function imagesDir(collection: CollectionName, slug: string): string {
  if (!isValidSlug(slug)) throw new ApiError(400, "BAD_REQUEST", "非法 slug");
  return path.join(
    config.repoPath,
    COLLECTION_DIRS[collection],
    "images",
    slug,
  );
}

function resolveCollection(value: string): CollectionName {
  if (!Object.hasOwn(COLLECTION_DIRS, value))
    throw new ApiError(400, "BAD_REQUEST", "不支持的内容板块");
  return value as CollectionName;
}
