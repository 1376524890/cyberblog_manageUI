import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../core/errors.ts";
import { listCollection } from "../core/content-store.ts";
import type { RankedRepo, Evidence } from "./github.ts";
export interface FeaturedRepo {
  repo: string;
  id?: number;
  slug: string;
  date: string;
  recordedAt: string;
}
const reserved = new Set([
  "topics",
  "trending",
  "features",
  "settings",
  "login",
  "sponsors",
  "orgs",
  "users",
  "marketplace",
  "collections",
  "about",
  "notifications",
]);
export function canonicalRepo(value: string): string | null {
  let v = value.trim();
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      if (u.hostname.toLowerCase() !== "github.com" || u.username || u.password)
        return null;
      v = u.pathname;
    } catch {
      return null;
    }
  }
  v = v.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const parts = v.split("/");
  if (parts.length < 2 || reserved.has(parts[0].toLowerCase())) return null;
  parts[1] = parts[1].replace(/\.git$/i, "");
  const repo = parts.slice(0, 2).join("/").toLowerCase();
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repo) &&
    !parts.slice(0, 2).some((p) => p === "." || p === "..")
    ? repo
    : null;
}
export async function scanFeaturedPosts(): Promise<FeaturedRepo[]> {
  const posts = await listCollection("posts"),
    result: FeaturedRepo[] = [];
  for (const post of posts) {
    const values = post.extraFields.githubRepos ?? post.data.githubRepos;
    const repos: { name: string; id?: number }[] = [];
    if (Array.isArray(values))
      for (const value of values) {
        if (typeof value === "string") repos.push({ name: value });
        else if (value && typeof value.name === "string") repos.push(value);
      }
    const links = [
      ...post.body.matchAll(
        /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g,
      ),
    ].map((m) => m[1]);
    const headings =
      String(post.data.title ?? "") +
      "\n" +
      (post.body.match(/^#{1,3} .+$/gm) ?? []).join("\n");
    const isDigest =
      /^github-daily-\d{4}-\d{2}-\d{2}$/.test(post.slug) ||
      (Array.isArray(post.data.tags) && post.data.tags.includes("每日热门"));
    for (const name of links)
      if (
        isDigest ||
        headings.toLowerCase().includes(name.split("/")[1].toLowerCase())
      )
        repos.push({ name });
    const unique = new Map<string, { name: string; id?: number }>();
    for (const item of repos) {
      const repo = canonicalRepo(item.name);
      if (repo) unique.set(repo, { ...unique.get(repo), ...item });
    }
    for (const [repo, item] of unique)
      result.push({
        repo,
        ...(Number.isSafeInteger(item.id) ? { id: item.id } : {}),
        slug: post.slug,
        date: String(post.data.published ?? ""),
        recordedAt: new Date().toISOString(),
      });
  }
  return result;
}
export async function featuredHistory(
  directory: string,
  current: FeaturedRepo[] = [],
): Promise<FeaturedRepo[]> {
  const file = path.join(directory, "featured-projects.json");
  let saved: FeaturedRepo[] = [];
  try {
    saved = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const map = new Map<string, FeaturedRepo>();
  for (const item of [...saved, ...current]) {
    const repo = canonicalRepo(item.repo);
    if (repo) {
      const old = map.get(repo);
      map.set(repo, { ...old, ...item, repo, id: item.id ?? old?.id });
    }
  }
  return [...map.values()];
}
export async function rememberFeatured(
  directory: string,
  entries: FeaturedRepo[],
) {
  const all = await featuredHistory(directory, entries);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "featured-projects.json");
  const tmp = file + ".tmp-" + randomUUID();
  await fs.writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
  return all;
}
export function selectUnfeatured(
  candidates: RankedRepo[],
  history: FeaturedRepo[],
  count = 5,
): RankedRepo[] {
  const seen = new Set(history.map((h) => canonicalRepo(h.repo))),
    selected: RankedRepo[] = [];
  for (const item of candidates) {
    const repo = canonicalRepo(item.name);
    if (!repo || seen.has(repo)) continue;
    seen.add(repo);
    selected.push({
      ...item,
      trendingRank: item.trendingRank ?? item.rank,
      rank: selected.length + 1,
    });
    if (selected.length === count) break;
  }
  if (selected.length < count)
    throw new ApiError(
      409,
      "DAILY_NEW_PROJECTS_INSUFFICIENT",
      `当天榜单中未介绍过的项目只有${selected.length}个，不重复选题凑数，稍后自动重试`,
    );
  return selected;
}
export function duplicateFeature(source: Evidence, history: FeaturedRepo[]) {
  const repo = canonicalRepo(source.name);
  return history.find(
    (h) =>
      canonicalRepo(h.repo) === repo ||
      (source.repositoryId !== undefined && h.id === source.repositoryId),
  );
}
