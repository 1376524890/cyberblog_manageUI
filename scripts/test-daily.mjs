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
  { length: 7 },
  (_, i) =>
    `<article class="Box-row"><h2><a href="/team/repo${i}"> repo </a></h2><span>1,234 stars today</span></article>`,
).join("");
const ranking = parseTrending(html);
check(
  "Daily ranking preserves first five and parses growth",
  ranking.length === 5 &&
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
  "Draft is private until review and has no password",
  post.data.draft === true && !post.data.password,
);
check(
  "Article contains five PNG embeds and no report template",
  (post.body.match(/!\[/g) ?? []).length === 5 &&
    !post.body.includes("```mermaid") &&
    !post.body.includes("阅读与复核说明"),
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
restored.setWriter(async () => {
  saved++;
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
const failureDir = await fs.mkdtemp(
  path.join(path.dirname(process.env.CMS_AI_ENV_FILE), "daily-failed-"),
);
let fail = true;
const failing = new DailyService(failureDir, {
  ...deps,
  generate: async () => {
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
  "Failure recorded without writing partial blog",
  (await failing.status()).runs[0].state === "failed" && saved === 2,
);
await failing.tick();
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
console.log(`Daily regression: ${checks} checks passed`);
process.exit(0);
