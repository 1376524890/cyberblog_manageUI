import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { simpleGit } from "simple-git";
import { config } from "../config.ts";
import { ApiError } from "./errors.ts";
import { buildFileContent, formatDate } from "./yaml.ts";
import { isValidSlug } from "./slugify.ts";
import { COLLECTION_DIRS, schemas, type CollectionName } from "./schemas.ts";

function getSchemaShape(collection: CollectionName): Record<string, unknown> {
  const s = schemas[collection];
  if ("shape" in s) return (s as { shape: Record<string, unknown> }).shape;
  return {};
}

export interface Version {
  head: string;
  fileMtimeMs: number;
}

export interface PostFile {
  slug: string;
  filePath: string; // 仓库相对路径
  data: Record<string, unknown>;
  extraFields: Record<string, unknown>;
  body: string;
  frontmatterRaw: string;
  version: Version;
}

/** 过滤 macOS AppleDouble 与隐藏文件 */
export function isJunk(name: string): boolean {
  return name.startsWith("._") || name.startsWith(".");
}

function collectionDir(collection: CollectionName): string {
  return path.join(config.repoPath, COLLECTION_DIRS[collection]);
}

export function repoRelative(absPath: string): string {
  return path.relative(config.repoPath, absPath);
}

export async function getHead(): Promise<string> {
  const g = simpleGit({ baseDir: config.repoPath });
  const log = await g.log(["-1", "--format=%H"]);
  return log.latest?.hash ?? "";
}

export async function statMtimeMs(absPath: string): Promise<number> {
  const st = await fs.promises.stat(absPath);
  return st.mtimeMs;
}

/** 读取 collection 下全部内容文件（过滤垃圾文件），附版本信息 */
export async function listCollection(
  collection: CollectionName,
): Promise<PostFile[]> {
  const dir = collectionDir(collection);
  if (!fs.existsSync(dir)) return [];
  const head = await getHead();
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const out: PostFile[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (isJunk(e.name)) continue;
    if (!/\.(md|mdx)$/i.test(e.name)) continue;
    const slug = e.name.replace(/\.(md|mdx)$/i, "");
    const parsed = await readParsed(collection, slug, head);
    if (!parsed) continue;
    out.push(parsed);
  }
  return out.sort((a, b) =>
    String(b.data.published).localeCompare(String(a.data.published)),
  );
}

async function readParsed(
  collection: CollectionName,
  slug: string,
  head?: string,
): Promise<PostFile | null> {
  const dir = collectionDir(collection);
  let abs: string | null = null;
  for (const ext of [".md", ".mdx"]) {
    const p = path.join(dir, `${slug}${ext}`);
    if (fs.existsSync(p)) {
      abs = p;
      break;
    }
  }
  if (!abs) return null;
  const raw = await fs.promises.readFile(abs, "utf8");
  const m = matter(raw);
  const schemaKeys = new Set(Object.keys(getSchemaShape(collection)));
  const data: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m.data)) {
    if (!schemaKeys.has(k)) {
      extra[k] = v;
      continue;
    }
    // 日期可能被解析为 Date 对象，统一格式化回 YYYY-MM-DD 字符串
    if (v instanceof Date) data[k] = formatDate(v);
    else data[k] = v;
  }
  if (collection === "dynamic" && !("title" in data) && "title" in extra) {
    data.title = extra.title;
  }
  return {
    slug,
    filePath: repoRelative(abs),
    data,
    extraFields: extra,
    body: m.content,
    frontmatterRaw: raw.slice(0, raw.indexOf("---", 3) + 3),
    version: {
      head: head ?? (await getHead()),
      fileMtimeMs: await statMtimeMs(abs),
    },
  };
}

export async function getOne(
  collection: CollectionName,
  slug: string,
): Promise<PostFile> {
  if (!slug || slug.includes("..") || /[\\/\0]/.test(slug))
    throw new ApiError(400, "BAD_REQUEST", "非法文件标识");
  const f = await readParsed(collection, slug);
  if (!f) throw new ApiError(404, "NOT_FOUND", `文章不存在: ${slug}`);
  return f;
}

/** 校验乐观锁：head/mtime 与加载时不一致 → 409 */
export async function checkVersion(
  collection: CollectionName,
  slug: string,
  expected: Version,
) {
  const head = await getHead();
  if (head !== expected.head) {
    throw new ApiError(409, "CONFLICT", "仓库已有新提交，请刷新后重试", {
      currentHead: head,
      expectedHead: expected.head,
    });
  }
  const current = await getOne(collection, slug);
  if (Math.abs(current.version.fileMtimeMs - expected.fileMtimeMs) > 0.01) {
    throw new ApiError(409, "CONFLICT", "文件已被他处修改，请刷新后重试");
  }
}

function assertSlugOrThrow(slug: string) {
  if (!isValidSlug(slug)) {
    throw new ApiError(
      422,
      "VALIDATION_FAILED",
      "slug 非法（仅小写字母数字短横线）",
    );
  }
}
void assertSlugOrThrow;

/** 原子写入：tmp + rename */
export async function atomicWrite(
  absPath: string,
  content: string,
): Promise<void> {
  const tmp = `${absPath}.tmp-${Date.now()}`;
  await fs.promises.writeFile(tmp, content, "utf8");
  await fs.promises.rename(tmp, absPath);
}

export interface ImageAsset {
  name: string;
  data: string;
}

export interface WriteInput {
  slug: string;
  data: Record<string, unknown>;
  extraFields?: Record<string, unknown>;
  body: string;
  assets?: ImageAsset[];
}

export async function writePost(
  collection: CollectionName,
  input: WriteInput,
): Promise<PostFile> {
  if (!isValidSlug(input.slug)) {
    throw new ApiError(422, "VALIDATION_FAILED", `slug 非法: ${input.slug}`);
  }
  const dir = collectionDir(collection);
  const abs = path.join(dir, `${input.slug}.md`);
  if (
    fs.existsSync(abs) ||
    fs.existsSync(path.join(dir, `${input.slug}.mdx`))
  ) {
    throw new ApiError(409, "CONFLICT", `文件已存在: ${input.slug}`);
  }
  await fs.promises.mkdir(dir, { recursive: true });
  const content = buildFileContent(
    collection,
    input.data,
    input.extraFields ?? {},
    input.body,
  );
  const assets = input.assets ?? [];
  if (assets.length > 5)
    throw new ApiError(422, "IMAGE_ASSETS", "单次最多附带 5 张 PNG 图片");
  const prepared: { name: string; buffer: Buffer }[] = [];
  for (const asset of assets) {
    if (
      !/^[a-z0-9][a-z0-9-]{0,80}\.png$/.test(asset.name) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data) ||
      asset.data.length > 2800000 ||
      prepared.some((p) => p.name === asset.name)
    )
      throw new ApiError(422, "IMAGE_ASSETS", "图片名称或编码无效");
    const buffer = Buffer.from(asset.data, "base64");
    const metadata = await sharp(buffer, { limitInputPixels: 8_000_000 })
      .metadata()
      .catch(() => null);
    if (
      !metadata ||
      metadata.format !== "png" ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 2400 ||
      metadata.height > 3200 ||
      buffer.length > 2 * 1024 * 1024
    )
      throw new ApiError(422, "IMAGE_ASSETS", "图片必须是有效且大小受限的 PNG");
    prepared.push({ name: asset.name, buffer });
  }
  const assetDir = path.join(dir, "images", input.slug);
  const written: string[] = [];
  try {
    if (prepared.length) {
      if (
        fs.existsSync(assetDir) &&
        (await fs.promises.readdir(assetDir)).length
      )
        throw new ApiError(
          409,
          "IMAGE_ASSETS",
          "目标图片目录已有内容，不会覆盖",
        );
      await fs.promises.mkdir(assetDir, { recursive: true });
      for (const item of prepared) {
        const file = path.join(assetDir, item.name);
        await fs.promises.writeFile(file, item.buffer, { flag: "wx" });
        written.push(file);
      }
    }
    await atomicWrite(abs, content);
  } catch (error) {
    for (const file of written) await fs.promises.unlink(file).catch(() => {});
    throw error;
  }

  return (await readParsed(collection, input.slug))!;
}

export async function updatePost(
  collection: CollectionName,
  slug: string,
  input: {
    data: Record<string, unknown>;
    extraFields?: Record<string, unknown>;
    body: string;
  },
): Promise<PostFile> {
  const existing = await getOne(collection, slug);
  const mergedData = { ...existing.data, ...input.data };
  // PUT 部分更新语义：显式传 null 的字段表示清除
  for (const [k, v] of Object.entries(input.data)) {
    if (v === null) delete mergedData[k];
  }
  const extra = { ...existing.extraFields, ...(input.extraFields ?? {}) };
  const content = buildFileContent(collection, mergedData, extra, input.body);
  let abs: string | null = null;
  for (const ext of [".md", ".mdx"]) {
    const p = path.join(collectionDir(collection), `${slug}${ext}`);
    if (fs.existsSync(p)) abs = p;
  }
  if (!abs) throw new ApiError(404, "NOT_FOUND", `文章不存在: ${slug}`);
  await atomicWrite(abs, content);
  return (await readParsed(collection, slug))!;
}

export async function deletePost(
  collection: CollectionName,
  slug: string,
  alsoDeleteImages?: boolean,
): Promise<string> {
  let abs: string | null = null;
  for (const ext of [".md", ".mdx"]) {
    const p = path.join(collectionDir(collection), `${slug}${ext}`);
    if (fs.existsSync(p)) abs = p;
  }
  if (!abs) throw new ApiError(404, "NOT_FOUND", `文章不存在: ${slug}`);
  await fs.promises.rm(abs);
  if (alsoDeleteImages) {
    const imgDir = path.join(collectionDir(collection), "images", slug);
    if (fs.existsSync(imgDir))
      await fs.promises.rm(imgDir, { recursive: true });
  }
  return repoRelative(abs);
}

/** dynamic slug：YYYY-MM-DD-HHMMSS（Asia/Shanghai） */
export function dynamicSlug(d = new Date()): string {
  const dt = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}-${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}${p(dt.getUTCSeconds())}`;
}

/** dynamic 的 title 落在 schema 外（mood 同理），保存时保留在 extra */
export function dynamicTitleToExtra(
  data: Record<string, unknown>,
  extra: Record<string, unknown>,
) {
  if ("title" in data) {
    extra.title = data.title;
    delete data.title;
  }
}
