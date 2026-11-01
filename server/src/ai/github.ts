import { ApiError } from "../core/errors.ts";
export const TRENDING = "https://github.com/trending?since=daily";
export interface RankedRepo {
  name: string;
  rank: number;
  trendingRank?: number;
  todayStars: number | null;
}
export interface Evidence extends RankedRepo {
  sha: string;
  repositoryId?: number;
  evidenceVersion?: number;
  researchVersion?: number;
  researchDepth?: number;
  treeVersion?: number;
  researchDiagnostics?: unknown;
  treeComplete?: boolean;
  corePlan?: {
    focus: string;
    mainFlow: string[];
    files: { path: string; role: string; why: string }[];
  };
  semanticReview?: {
    passed: boolean;
    checks: {
      coreFlow: boolean;
      usefulDetail: boolean;
      grounded: boolean;
      blogVoice: boolean;
      issues: string[];
    };
    reviewedAt: string;
  };
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
    if (out.length === 30) break;
  }
  if (out.length === 0)
    throw new ApiError(
      502,
      "GITHUB_RANKING",
      "GitHub 日榜为空或格式变化，本次不生成文章，未使用替代榜单",
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
  const picked = [readme, manifest, ...selectSources(sources, 5)].filter(
    Boolean,
  );
  if (!picked.length)
    throw new ApiError(
      422,
      "GITHUB_NO_CODE",
      `${repo.name} 未找到可读取的源码或文档，停止生成`,
    );
  const files: Evidence["files"] = [];
  const readableTree = blobs.map((f: any) => String(f.path));
  for (const f of picked) {
    const file = await readPublicRepoFile(
      { name: repo.name, sha, tree: readableTree } as Evidence,
      f.path,
    );
    files.push({
      ...file,
      text: file.text.slice(0, f === readme ? 6500 : 6000),
    });
  }
  if (!files.length) throw new Error("No readable samples");
  return {
    ...repo,
    sha,
    evidenceVersion: 3,
    treeVersion: 6,
    treeComplete: !tree.truncated,
    codeSampled: files.some((f) => sources.some((s: any) => s.path === f.path)),
    repositoryId: meta.id,
    description: String(meta.description ?? "").slice(0, 1000),
    stars: meta.stargazers_count,
    language: meta.language ?? "未标注",
    license: meta.license?.spdx_id ?? "未标注",
    tree: [
      ...new Set([
        ...files.map((f) => f.path),
        ...blobs.map((f: any) => String(f.path)),
      ]),
    ],
    truncated: !!tree.truncated,
    files,
  };
}

function selectSources(files: any[], count: number) {
  const scored = [...files]
    .filter((f) => !/\.(test|spec)\./i.test(f.path))
    .sort((a, b) => {
      const score = (p: string) =>
        (/(^|\/)(src|lib|app|server|backend|core)\//.test(p) ? -35 : 0) +
        (/worker|session|agent|memory|storage|database|router|pipeline|client|manager|service|engine/i.test(
          p,
        )
          ? -40
          : 0) +
        (/^(scripts|\.github|docs|tools)\//.test(p) ? 60 : 0) +
        p.split("/").length * 4;
      return score(a.path) - score(b.path);
    });
  const result: any[] = [];
  for (const file of scored) {
    const parent = file.path.split("/").slice(0, -1).join("/");
    if (
      result.filter((f) => f.path.split("/").slice(0, -1).join("/") === parent)
        .length >= 2
    )
      continue;
    result.push(file);
    if (result.length === count) break;
  }
  return result;
}
export async function enrichEvidence(previous: Evidence): Promise<Evidence> {
  const base = `/repos/${previous.name}`;
  const tree = await api(`${base}/git/trees/${previous.sha}?recursive=1`);
  const blobs = (tree.tree ?? []).filter(
    (f: any) => f.type === "blob" && f.size > 0 && f.size < 250000,
  );
  const read = new Set(previous.files.map((f) => f.path));
  const extra = selectSources(
    blobs.filter(
      (f: any) =>
        !read.has(f.path) &&
        /\.(ts|tsx|js|py|go|rs|java|cpp|svelte)$/.test(f.path) &&
        !/(^|\/)(test|tests|fixtures|examples|vendor|node_modules|dist|\.github)\//.test(
          f.path,
        ) &&
        !/\.d\.ts$/.test(f.path),
    ),
    3,
  );
  const files = [...previous.files];
  for (const file of extra) {
    const blob = await api(`${base}/git/blobs/${file.sha}`);
    if (blob.encoding !== "base64") continue;
    const text = Buffer.from(blob.content, "base64")
      .toString("utf8")
      .slice(0, 10000);
    if (text.includes("\0")) continue;
    files.push({
      path: file.path,
      text,
      url: `https://github.com/${previous.name}/blob/${previous.sha}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
    });
  }
  return {
    ...previous,
    evidenceVersion: 2,
    files,
    tree: [...new Set([...previous.tree, ...files.map((f) => f.path)])],
  };
}

export function sourceLinesFromGitHubHTML(html: string): string | null {
  for (const match of html.matchAll(
    /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    let root: unknown;
    try {
      root = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const queue: unknown[] = [root];
    let visited = 0;
    while (queue.length && visited++ < 50000) {
      const item: any = queue.pop();
      if (!item || typeof item !== "object") continue;
      if (
        Array.isArray(item.rawLines) &&
        item.rawLines.every((line: unknown) => typeof line === "string")
      )
        return item.rawLines.join("\n");
      for (const value of Object.values(item))
        if (queue.length < 50000) queue.push(value);
    }
  }
  return null;
}
export async function readPublicRepoFile(source: Evidence, file: string) {
  if (
    !source.tree.includes(file) ||
    file.split("/").some((p) => p === ".." || p === ".") ||
    !/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cpp|h|c|svelte|vue|sh|kt|swift|rb|ex|exs|json|toml|md|mod|xml|rst|txt)$/i.test(
      file,
    )
  )
    throw new ApiError(422, "DAILY_EVIDENCE", "不能读取资料目录之外的代码路径");
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  const url = `https://github.com/${source.name}/blob/${source.sha}/${encoded}`;
  let text = sourceLinesFromGitHubHTML(await download(url));
  if (text === null)
    text = await download(
      `https://api.github.com/repos/${source.name}/contents/${encoded}?ref=${source.sha}`,
      { Accept: "application/vnd.github.raw+json" },
    );
  if (!text || text.includes("\0"))
    throw new ApiError(502, "DAILY_EVIDENCE", "源码页面未提供可读取文本");
  return { path: file, text: text.slice(0, 18000), url };
}

export async function completeSourceTree(source: Evidence): Promise<Evidence> {
  if (source.treeComplete && source.treeVersion === 6) return source;
  const tree = await api(
    `/repos/${source.name}/git/trees/${source.sha}?recursive=1`,
  );
  const paths = (tree.tree ?? [])
    .filter(
      (f: any) =>
        f.type === "blob" &&
        /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|svelte|vue|sh|kt|swift|rb|ex|exs|md|json|toml)$/.test(
          f.path,
        ) &&
        !/(^|\/)(node_modules|vendor|dist|build|fixtures)\//.test(f.path),
    )
    .map((f: any) => String(f.path));
  return {
    ...source,
    treeVersion: 6,
    treeComplete: true,
    tree: [...new Set([...source.files.map((f) => f.path), ...paths])],
    truncated: !!tree.truncated,
  };
}
