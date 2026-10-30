import { ApiError } from "../core/errors.ts";
export const TRENDING = "https://github.com/trending?since=daily";
export interface RankedRepo {
  name: string;
  rank: number;
  todayStars: number | null;
}
export interface Evidence extends RankedRepo {
  sha: string;
  codeSampled: boolean;
  description: string;
  stars: number;
  language: string;
  license: string;
  tree: string[];
  truncated: boolean;
  files: { path: string; text: string; url: string }[];
}
const decode = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
export function parseTrending(html: string): RankedRepo[] {
  const rows = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)];
  const out: RankedRepo[] = [];
  for (const [row] of rows) {
    const heading = row.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "";
    const name = heading.match(
      /href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/,
    )?.[1];
    if (!name || out.some((r) => r.name === name)) continue;
    const count = decode(row).match(/([\d,]+)\s+stars today/i)?.[1];
    out.push({
      name,
      rank: out.length + 1,
      todayStars: count ? Number(count.replaceAll(",", "")) : null,
    });
    if (out.length === 5) break;
  }
  if (out.length !== 5)
    throw new ApiError(
      502,
      "GITHUB_RANKING",
      "GitHub 日榜格式变化或不足 5 项，已停止生成，未使用替代榜单",
    );
  return out;
}
async function download(url: string, headers: Record<string, string> = {}) {
  const u = new URL(url);
  if (
    !["github.com", "api.github.com"].includes(u.hostname) ||
    u.protocol !== "https:"
  )
    throw new Error("GitHub host required");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "CyberBlog-Daily/1.0", ...headers },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw new ApiError(
          502,
          "GITHUB_HTTP",
          `GitHub 返回 HTTP ${r.status}，请检查服务可用性或 API 配额`,
        );
      }
      if (Number(r.headers.get("content-length")) > 16_000_000)
        throw new Error("Response limit");
      const reader = r.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16_000_000) {
          await reader.cancel();
          throw new Error("Response limit");
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } catch (e) {
      if (e instanceof ApiError || attempt === 2)
        throw e instanceof ApiError
          ? e
          : new ApiError(
              502,
              "GITHUB_NETWORK",
              "GitHub 连接失败或响应超限，请稍后重试",
            );
    }
  }
  throw new Error("unreachable");
}
export async function trending() {
  return parseTrending(await download(TRENDING));
}
const api = async (p: string) =>
  JSON.parse(
    await download(`https://api.github.com${p}`, {
      Accept: "application/vnd.github+json",
    }),
  );
export async function evidence(repo: RankedRepo): Promise<Evidence> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.name))
    throw new Error("Invalid repository");
  const base = `/repos/${repo.name}`;
  const meta = await api(base);
  const commit = (await api(`${base}/commits?per_page=1`))[0];
  if (!/^[a-f0-9]{40}$/.test(commit?.sha)) throw new Error("No commit");
  const sha = commit.sha;
  const tree = await api(`${base}/git/trees/${sha}?recursive=1`);
  const blobs = (tree.tree ?? []).filter(
    (f: any) =>
      f.type === "blob" &&
      f.size > 0 &&
      f.size < 500000 &&
      !/(^|\/)(vendor|node_modules|dist|\.git|test|tests|fixtures|examples)\//i.test(
        f.path,
      ),
  );
  const readme = blobs.find((f: any) =>
    /^readme(?:\.md|\.rst|\.txt)?$/i.test(f.path),
  );
  const manifest = blobs.find((f: any) =>
    /^(package.json|pyproject.toml|Cargo.toml|go.mod|pom.xml)$/.test(f.path),
  );
  const sources = blobs
    .filter(
      (f: any) =>
        /\.(ts|js|py|go|rs|java|cpp|tsx|svelte|sh)$/.test(f.path) &&
        !/(lock|\.d\.ts|\.min\.)/.test(f.path),
    )
    .sort((a: any, b: any) => {
      const score = (p: string) =>
        (/\b(main|index|app|server|cli|__main__)\./.test(p) ? -100 : 0) +
        p.split("/").length * 10 +
        p.length / 100;
      return score(a.path) - score(b.path);
    });
  const picked = [readme, manifest, ...sources.slice(0, 2)].filter(Boolean);
  if (!picked.length)
    throw new ApiError(
      422,
      "GITHUB_NO_CODE",
      `${repo.name} 未找到可读取的源码或文档，停止生成`,
    );
  const files: Evidence["files"] = [];
  for (const f of picked) {
    if (!/^[a-f0-9]{40}$/.test(f.sha)) continue;
    const blob = await api(`${base}/git/blobs/${f.sha}`);
    if (blob.encoding !== "base64") continue;
    const text = Buffer.from(blob.content, "base64")
      .toString("utf8")
      .slice(0, f === readme ? 6500 : 6000);
    if (text.includes("\0")) continue;
    files.push({
      path: f.path,
      text,
      url: `https://github.com/${repo.name}/blob/${sha}/${f.path.split("/").map(encodeURIComponent).join("/")}`,
    });
  }
  if (!files.length) throw new Error("No readable samples");
  return {
    ...repo,
    sha,
    codeSampled: files.some((f) => sources.some((s: any) => s.path === f.path)),
    description: String(meta.description ?? "").slice(0, 1000),
    stars: meta.stargazers_count,
    language: meta.language ?? "未标注",
    license: meta.license?.spdx_id ?? "未标注",
    tree: [...new Set([...files.map(f => f.path), ...blobs.slice(0, 400).map((f: any) => String(f.path))])],
    truncated: !!tree.truncated || blobs.length > 400,
    files,
  };
}
