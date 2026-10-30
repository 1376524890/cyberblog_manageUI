import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DailyService,
  dayInShanghai,
  nextRun,
  diagram,
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
  intro: "代码介绍。".repeat(30),
  codeAnalysis: "入口引用模块，关系依据样本推导。".repeat(20),
  audience: "适合阅读源码与研究项目组织方式的开发者。".repeat(4),
  limitations: "没有执行代码或完整审计，结论仅依据本次样本。".repeat(4),
  nodes: [
    { label: "入口", path: "src/main.ts" },
    { label: "模块", path: "src/lib.ts" },
  ],
  edges: [{ from: 0, to: 1, label: "导入", evidence: "src/main.ts" }],
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
    { ...makeAnalysis(), intro: "<script>attack</script>".repeat(5) },
    ev,
  ),
);
checks++;
assert.throws(() =>
  validateAnalysis(
    { ...makeAnalysis(), intro: "介绍".repeat(60) + " https://evil.test/" },
    ev,
  ),
);
checks++;
check(
  "Diagram restricted to graph syntax",
  diagram(makeAnalysis()).includes('n0 -->|"导入"| n1'),
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
  "Article contains five diagrams and pinned source links",
  post.body.match(/```mermaid/g).length === 5 &&
    post.body.includes("a".repeat(40)),
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
