import {
  canonicalRepo,
  scanFeaturedPosts,
  featuredHistory,
  rememberFeatured,
  selectUnfeatured,
  duplicateFeature,
} from "../server/src/ai/dedup.ts";
import { assertCoreDiagram } from "../server/src/ai/research.ts";
import sharp from "../server/node_modules/sharp/lib/index.js";
import { renderArchitecturePNG } from "../server/src/ai/architecture.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DailyService,
  dayInShanghai,
  nextRun,
  validateAnalysis,
} from "../server/src/ai/daily.ts";
import { parseTrending } from "../server/src/ai/github.ts";
import { ApiError } from "../server/src/core/errors.ts";
if (
  !process.env.CMS_REPO_PATH?.includes("test-fixtures/") ||
  !process.env.CMS_AI_ENV_FILE?.includes("test-fixtures/")
)
  throw Error("Isolated fixtures required");
await import("../server/src/index.ts");
const base = `http://127.0.0.1:${process.env.PORT}/api/v1`;
let checks = 0;
function check(name, ok) {
  assert.ok(ok, name);
  console.log("✓", name);
  checks++;
}
const html = Array.from(
  { length: 12 },
  (_, i) =>
    `<article class="Box-row"><h2><a href="/team/repo${i}"> repo </a></h2><span>1,234 stars today</span></article>`,
).join("");
const ranking = parseTrending(html);
check(
  "Daily ranking retains candidate pool and parses growth",
  ranking.length === 12 &&
    ranking[0].name === "team/repo0" &&
    ranking[4].todayStars === 1234,
);
assert.throws(() => parseTrending("<html>rate limited</html>"));
checks++;
check(
  "Shanghai date boundary",
  dayInShanghai(new Date("2026-10-30T16:00:00Z")) === "2026-10-31",
);
check(
  "Next run at 08:00 Shanghai",
  nextRun(new Date("2026-10-30T00:01:00Z")) === "2026-10-31T00:00:00.000Z",
);
let now = new Date("2026-10-30T00:00:00Z"),
  generated = 0,
  saved = 0;
const makeEvidence = (repo) => ({
  ...repo,
  sha: "a".repeat(40),
  treeComplete: true,
  corePlan: {
    focus: "fixture workflow",
    mainFlow: ["entry", "process"],
    files: [
      { path: "src/main.ts", role: "入口", why: "接收任务" },
      { path: "src/lib.ts", role: "处理", why: "执行任务" },
    ],
  },
  semanticReview: {
    passed: true,
    checks: {
      coreFlow: true,
      usefulDetail: true,
      grounded: true,
      blogVoice: true,
      issues: [],
    },
    reviewedAt: new Date().toISOString(),
  },
  description: "测试",
  language: "TypeScript",
  stars: 100,
  license: "MIT",
  tree: ["src/main.ts", "src/lib.ts"],
  truncated: false,
  files: [
    {
      path: "src/main.ts",
      text: 'import lib from "./lib";',
      url: `https://github.com/${repo.name}/blob/${"a".repeat(40)}/src/main.ts`,
    },
  ],
});
const makeAnalysis = () => ({
  headline: "用代码串起日常开发",
  paragraphs: Array.from({ length: 6 }, (_, i) =>
    "这个项目把常见的开发步骤整理成可以直接使用的模块，入口接收请求后交给核心逻辑处理，再由数据层保存结果。沿着文件之间的协作关系阅读，容易找到适合自己项目的实现方式，也可以从一个具体任务开始了解整套设计。".repeat(
      2,
    ),
  ),
  diagramTitle: "从入口到核心模块的协作",
  nodes: [
    {
      label: "入口",
      path: "src/main.ts",
      description: "接收任务并调用模块",
      layer: "entry",
    },
    {
      label: "业务模块",
      path: "src/lib.ts",
      description: "处理任务并返回结果",
      layer: "core",
    },
  ],
  edges: [{ from: 0, to: 1, label: "调用", evidence: "src/main.ts" }],
});
const ev = makeEvidence(ranking[0]);
const planSource = makeEvidence(ranking[0]);
planSource.corePlan.files.push({
  path: "src/storage.ts",
  role: "存储",
  why: "持久化结果",
});
assert.throws(() => assertCoreDiagram(planSource, makeAnalysis()));
checks++;
const disconnected = makeAnalysis();
disconnected.edges = [];
assert.throws(() => assertCoreDiagram(makeEvidence(ranking[0]), disconnected));
checks++;

assert.throws(() =>
  validateAnalysis(
    {
      ...makeAnalysis(),
      edges: [{ from: 0, to: 9, label: "", evidence: "no.ts" }],
    },
    ev,
  ),
);
checks++;
assert.throws(() =>
  validateAnalysis(
    {
      ...makeAnalysis(),
      paragraphs: [
        "<script>attack</script>".repeat(5),
        ...makeAnalysis().paragraphs.slice(1),
      ],
    },
    ev,
  ),
);
checks++;
assert.throws(() =>
  validateAnalysis(
    {
      ...makeAnalysis(),
      paragraphs: [
        "介绍".repeat(60) + " https://evil.test/",
        ...makeAnalysis().paragraphs.slice(1),
      ],
    },
    ev,
  ),
);
checks++;
assert.throws(() =>
  validateAnalysis(
    {
      ...makeAnalysis(),
      paragraphs: [
        "本次分析未执行代码，不能代表整体架构。" + makeAnalysis().paragraphs[0],
        ...makeAnalysis().paragraphs.slice(1),
      ],
    },
    ev,
  ),
);
checks++;
const png = await renderArchitecturePNG("example/project", makeAnalysis());
const metadata = await sharp(png).metadata();
check(
  "Architecture exported as a real high-resolution PNG",
  metadata.format === "png" && metadata.width === 1800 && png.length > 10000,
);

const dir = await fs.mkdtemp(
  path.join(path.dirname(process.env.CMS_AI_ENV_FILE), "daily-test-"),
);
const deps = {
  history: async () => [],
  trending: async () => ranking,
  evidence: async (r) => makeEvidence(r),
  generate: async () => {
    generated++;
    return { model: "mock", analysis: makeAnalysis() };
  },
  overview: async (date) => ({
    title: `开源精选 ${date}`,
    lead: "开发中的许多麻烦，都可以从开源项目里找到细致的解法。".repeat(5),
    closing:
      "把这些设计放回自己的开发环境，便能找到适合继续研究的方向。".repeat(3),
  }),
  now: () => now,
};
const service = new DailyService(dir, deps);
check(
  "Automation disabled by default before explicit enable",
  !(await service.status()).enabled,
);
const auth = await fetch(base + "/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "admin123" }),
}).then((r) => r.json());
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${auth.token}`,
};
check(
  "Daily API requires authentication",
  (await fetch(base + "/ai/daily")).status === 401,
);
check(
  "Authenticated daily state readable",
  (await fetch(base + "/ai/daily", { headers })).status === 200,
);
const originBefore = execFileSync("git", ["rev-parse", "origin/main"], {
  cwd: process.env.CMS_REPO_PATH,
  encoding: "utf8",
}).trim();
service.setWriter(async (draft) => {
  saved++;
  const r = await fetch(base + "/posts", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...draft, commit: true }),
  });
  assert.equal(r.status, 201);
});
const starts = await Promise.all([
  service.start(),
  service.start(),
  service.start(),
]);
check(
  "Concurrent start creates one task",
  starts.filter((s) => s.started).length === 1,
);
await service.wait();
const status = await service.status();
check(
  "Five repositories analyzed once, one draft saved",
  generated === 5 && saved === 1 && status.runs[0].state === "done",
);
const post = await fetch(base + "/posts/github-daily-2026-10-30", {
  headers,
}).then((r) => r.json());
check(
  "Article records canonical featured identities",
  post.extraFields.githubRepos.length === 5,
);
const scanned = await scanFeaturedPosts();
check(
  "Existing draft scan finds featured projects",
  scanned.filter((h) => h.slug === post.slug).length === 5,
);
check(
  "Draft is private until review and has no password",
  post.data.draft === true && !post.data.password,
);
check(
  "Article contains five PNG embeds and no report template",
  (post.body.match(/!\[/g) ?? []).length === 5 &&
    !post.body.includes("```mermaid") &&
    !post.body.includes("阅读与复核说明"),
);
check(
  "Automatic draft joins GitHub daily series with stable chapter order",
  post.data.series === "GitHub每日精选" && post.data.seriesOrder === 1,
);
const files = execFileSync(
  "git",
  ["show", "--name-only", "--format=", "HEAD"],
  { cwd: process.env.CMS_REPO_PATH, encoding: "utf8" },
);
check(
  "Five PNGs committed together with article",
  files.split("\n").filter((f) => f.endsWith(".png")).length === 5,
);
const invalid = await fetch(base + "/posts", {
  method: "POST",
  headers,
  body: JSON.stringify({
    slug: "reject-image",
    data: { title: "Bad", published: "2026-10-30" },
    body: "bad",
    assets: [{ name: "../bad.png", data: png.toString("base64") }],
  }),
});
check("Rejects image path traversal", invalid.status === 422);
const invalidPNG = await fetch(base + "/posts", {
  method: "POST",
  headers,
  body: JSON.stringify({
    slug: "reject-png",
    data: { title: "Bad", published: "2026-10-30" },
    body: "bad",
    assets: [
      { name: "bad.png", data: Buffer.from("not a PNG").toString("base64") },
    ],
  }),
});
check(
  "Rejects invalid PNG before writing article",
  invalidPNG.status === 422 &&
    !(await fs
      .stat(
        path.join(process.env.CMS_REPO_PATH, "src/content/posts/reject-png.md"),
      )
      .catch(() => null)),
);

check(
  "Creation did not push",
  execFileSync("git", ["rev-parse", "origin/main"], {
    cwd: process.env.CMS_REPO_PATH,
    encoding: "utf8",
  }).trim() === originBefore,
);
check("Completed day cannot run again", !(await service.start()).started);
const restored = new DailyService(dir, deps);
check(
  "Success persists after service reconstruction",
  (await restored.status()).runs[0].state === "done",
);
await restored.configure(true);
restored.setWriter(async (draft) => {
  saved++;
  const response = await fetch(base + "/posts", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...draft, commit: true }),
  });
  assert.equal(response.status, 201);
});
await restored.tick();
await restored.wait();
check("Scheduler skips existing completed day", saved === 1);
now = new Date("2026-10-30T23:59:00Z");
await restored.tick();
await restored.wait();
check("Does not run before 08:00 next day", saved === 1);
now = new Date("2026-10-31T00:00:00Z");
await restored.tick();
await restored.wait();
check("Runs next day at 08:00", saved === 2);
const scheduled = await fetch(base + "/posts/github-daily-2026-10-31", {
  headers,
}).then((r) => r.json());
check(
  "Scheduled run saves a real illustrated draft through the same API",
  scheduled.data.draft === true &&
    (scheduled.body.match(/!\[/g) ?? []).length === 5,
);
check(
  "Next scheduled day continues the same series automatically",
  scheduled.data.series === "GitHub每日精选" &&
    scheduled.data.seriesOrder === 2,
);
check(
  "Scheduled draft passed automatic quality gates",
  (await restored.status()).runs[0].quality?.passed === true,
);
check(
  "Next day excludes every previous project",
  scheduled.extraFields.githubRepos.every(
    (r) =>
      !post.extraFields.githubRepos.some(
        (p) => canonicalRepo(p.name) === canonicalRepo(r.name),
      ),
  ),
);
check(
  "Original daily ranking retained after filtering",
  (await restored.status()).runs[0].ranking[0].trendingRank === 6,
);
check(
  "Canonical names ignore URL case and git suffix",
  canonicalRepo("https://github.com/Team/Repo.git/blob/main/a.ts") ===
    "team/repo",
);
check(
  "Rejects non GitHub URLs and special pages",
  canonicalRepo("https://evil.test/a/b") === null &&
    canonicalRepo("https://github.com/topics/test") === null,
);
const durable = await featuredHistory(dir);
check("Feature ledger survives service restart", durable.length === 10);
assert.throws(() => selectUnfeatured(ranking, durable), /只有2个/);
checks++;
check(
  "Rename identified by stable repository ID",
  !!duplicateFeature({ ...ev, name: "team/renamed", repositoryId: 42 }, [
    { repo: "old/name", id: 42, slug: "x", date: "", recordedAt: "" },
  ]),
);
const blocked = new DailyService(dir, deps);
blocked.setWriter(async () => {
  throw Error("Should not write");
});
now = new Date("2026-11-01T00:00:00Z");
await blocked.configure(true);
await blocked.tick();
await blocked.wait();
check(
  "Insufficient fresh candidates fail without recycling or partial draft",
  (await blocked.status()).runs[0].state === "failed" &&
    (await featuredHistory(dir)).length === 10,
);
const failureDir = await fs.mkdtemp(
  path.join(path.dirname(process.env.CMS_AI_ENV_FILE), "daily-failed-"),
);
let fail = true;
const failing = new DailyService(failureDir, {
  ...deps,
  generate: async (source, progress) => {
    source.corePlan.focus = "Persistent research checkpoint";
    await progress("保存研究检查点");
    const checkpoint = JSON.parse(
      await fs.readFile(
        path.join(failureDir, dayInShanghai(now), "1-source-v5.json"),
        "utf8",
      ),
    );
    assert.equal(checkpoint.corePlan.focus, "Persistent research checkpoint");
    if (fail) throw new ApiError(502, "AI_CONNECTION", "模型暂不可用");
    return { model: "mock", analysis: makeAnalysis() };
  },
});
failing.setWriter(async () => {
  saved++;
});
await failing.configure(true);
await failing.tick();
await failing.wait();
check(
  "Failed generation does not mark projects as featured",
  (await featuredHistory(failureDir)).length === 0,
);
check(
  "Failure recorded without writing partial blog",
  (await failing.status()).runs[0].state === "failed" && saved === 2,
);
await failing.tick();
const failedSource = JSON.parse(
  await fs.readFile(
    path.join(
      failureDir,
      (await failing.status()).runs[0].date,
      "1-source-v5.json",
    ),
    "utf8",
  ),
);
check(
  "Failed model call persists research progress for automatic retry",
  failedSource.corePlan.focus === "Persistent research checkpoint",
);
check(
  "Failure records repository, stage and error code",
  (await failing.status()).runs[0].failure.project === "team/repo0" &&
    (await failing.status()).runs[0].failure.code === "AI_CONNECTION",
);
check("No tight retry loop", (await failing.status()).runs[0].attempts === 1);
now = new Date(now.getTime() + 10 * 60000);
fail = false;
await failing.tick();
await failing.wait();
check(
  "Retry after ten minutes resumes and succeeds",
  (await failing.status()).runs[0].state === "done" && saved === 3,
);
await failing.configure(false);
now = new Date(now.getTime() + 86400000);
await failing.tick();
check("Paused schedule creates nothing", saved === 3);
// Same-date retry after a newly featured repository changes the selected ranks.
const cacheDir = await fs.mkdtemp(
  path.join(path.dirname(process.env.CMS_AI_ENV_FILE), "daily-cache-"),
);
let attempt = 0,
  addedHistory = [],
  seenNames = [];
const cacheService = new DailyService(cacheDir, {
  ...deps,
  history: async () => addedHistory,
  generate: async (source) => {
    seenNames.push(source.name);
    if (attempt === 0 && source.rank === 2)
      throw new ApiError(502, "AI_CONNECTION", "temporary");
    return { model: "mock", analysis: makeAnalysis() };
  },
});
cacheService.setWriter(async (d) => {
  check(
    "Changed ranking uses matching source identities",
    d.githubRepos[0].name === "team/repo1" &&
      !d.githubRepos.some((r) => r.name === "team/repo0"),
  );
});
await cacheService.start();
await cacheService.wait();
attempt++;
addedHistory = [
  { repo: "team/repo0", slug: "other", date: "", recordedAt: "" },
];
await cacheService.start();
await cacheService.wait();
check(
  "Retry invalidates stale rank-based source and analysis caches",
  (await cacheService.status()).runs[0].state === "done" &&
    seenNames.filter((n) => n === "team/repo1").length === 2,
);
const preservedDir = await fs.mkdtemp(
  path.join(path.dirname(process.env.CMS_AI_ENV_FILE), "daily-preserve-"),
);
const preserved = new DailyService(preservedDir, deps);
preserved.setWriter(async () => ({ existing: true }));
await preserved.start();
await preserved.wait();
check(
  "Preserved existing article does not claim new projects or quality approval",
  (await featuredHistory(preservedDir)).length === 0 &&
    !(await preserved.status()).runs[0].quality,
);
const upgradedDir = await fs.mkdtemp(
  path.join(path.dirname(process.env.CMS_AI_ENV_FILE), "daily-upgrade-"),
);
const upgradeDate = dayInShanghai(now);
await fs.writeFile(
  path.join(upgradedDir, "state.json"),
  JSON.stringify({
    enabled: true,
    runs: [
      {
        date: upgradeDate,
        state: "failed",
        attempts: 3,
        workflowVersion: "old-policy",
        startedAt: new Date(now.getTime() - 15 * 60000).toISOString(),
        finishedAt: new Date(now.getTime() - 11 * 60000).toISOString(),
      },
    ],
  }),
);
const upgraded = new DailyService(upgradedDir, deps);
let upgradeWrites = 0;
upgraded.setWriter(async () => {
  upgradeWrites++;
});
await upgraded.tick();
await upgraded.wait();
check(
  "Scheduler automatically retries exhausted old-version task after workflow upgrade",
  upgradeWrites === 1 &&
    (await upgraded.status()).runs[0].attempts === 1 &&
    (await upgraded.status()).runs[0].state === "done",
);
const fallbackDir = await fs.mkdtemp(
  path.join(path.dirname(process.env.CMS_AI_ENV_FILE), "daily-fallback-"),
);
const fallbackService = new DailyService(fallbackDir, {
  ...deps,
  generate: async (source) => {
    if (source.name === "team/repo0")
      throw new ApiError(422, "DAILY_EDITORIAL_REVIEW", "项目未通过审稿");
    return { model: "mock", analysis: makeAnalysis() };
  },
});
let fallbackDraft;
fallbackService.setWriter(async (d) => {
  fallbackDraft = d;
});
await fallbackService.configure(true);
await fallbackService.tick();
await fallbackService.wait();
check(
  "Content failure automatically selects the next fresh daily candidate",
  (await fallbackService.status()).runs[0].state === "done" &&
    fallbackDraft.githubRepos.map((r) => r.name).join(",") ===
      "team/repo1,team/repo2,team/repo3,team/repo4,team/repo5",
);
check(
  "Unqualified candidate retains reason but is not marked featured",
  (await fallbackService.status()).runs[0].skipped[0].name === "team/repo0" &&
    !(await featuredHistory(fallbackDir)).some((h) => h.repo === "team/repo0"),
);
const exhaustedDir = await fs.mkdtemp(
  path.join(path.dirname(process.env.CMS_AI_ENV_FILE), "daily-exhausted-"),
);
let rejects = 0;
const exhaustedService = new DailyService(exhaustedDir, {
  ...deps,
  generate: async () => {
    rejects++;
    throw new ApiError(422, "DAILY_RESEARCH", "未获得实际实现");
  },
});
let exhaustedWrites = 0;
exhaustedService.setWriter(async () => {
  exhaustedWrites++;
});
await exhaustedService.start();
await exhaustedService.wait();
check(
  "Candidate budget stops bad content without writing a partial draft",
  rejects <= 10 &&
    rejects >= 5 &&
    exhaustedWrites === 0 &&
    (await exhaustedService.status()).runs[0].state === "failed",
);
const rejectedBeforeRetry = rejects;
await exhaustedService.start();
await exhaustedService.wait();
check(
  "Retry remembers today's rejected candidates instead of repeating failed research",
  rejects === rejectedBeforeRetry,
);
console.log(`Daily regression: ${checks} checks passed`);
process.exit(0);
