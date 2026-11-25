import {
  sourceLinesFromGitHubHTML,
  readPublicRepoFile,
} from "../server/src/ai/github.ts";
import { complete } from "../server/src/ai/provider.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { generateAnalysis, generateOverview } from "../server/src/ai/daily.ts";
import { planCoreResearch } from "../server/src/ai/research.ts";
import { saveSettings, readSettings } from "../server/src/ai/settings.ts";
import { usageReport } from "../server/src/ai/usage.ts";
if (!process.env.CMS_AI_ENV_FILE?.includes("test-fixtures/"))
  throw Error("Isolated settings required");
const analysis = {
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
};
let calls = 0,
  overviewCalls = 0,
  mode = "repair",
  hasFeedback = false,
  lastRequest = null;
const server = http.createServer(async (req, res) => {
  let text = "";
  for await (const c of req) text += c;
  const body = JSON.parse(text);
  lastRequest = body;
  calls++;
  hasFeedback = body.messages.length > 2;
  if (mode === "auth") {
    res.writeHead(401);
    res.end("{}");
    return;
  }
  if (mode === "empty") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    );
    return;
  }
  if (mode === "overview") {
    overviewCalls++;
    const content =
      overviewCalls === 1
        ? "not valid JSON"
        : JSON.stringify({
            title: "开源精选 2026-10-30",
            lead: "开发中的许多麻烦，都可以从开源项目里找到细致的解法。这些项目覆盖不同场景，但共同点是文档、实现和工具链都足够具体，适合放回自己的开发环境继续研究。".repeat(2),
            closing: "把这些设计放回自己的开发环境，便能找到适合继续研究的方向。".repeat(3),
          });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { role: "assistant", content } },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    );
    return;
  }
  const content =
    mode === "bad" || calls === 1 ? "not valid JSON" : JSON.stringify(analysis);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content } },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
await saveSettings({
  enabled: true,
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
  model: "daily-test",
  apiKey: "isolated-key",
  mode: "tools",
  temperature: null,
  maxTokens: 2048,
  timeoutSeconds: 10,
  systemPrompt: "",
  tokenParameter: "max_tokens",
});
const source = {
  name: "example/repo",
  rank: 1,
  todayStars: 3,
  sha: "a".repeat(40),
  codeSampled: true,
  description: "",
  stars: 10,
  language: "TS",
  license: "MIT",
  tree: ["src/main.ts", "src/lib.ts"],
  truncated: false,
  files: [
    {
      path: "src/main.ts",
      text: "import lib",
      url: `https://github.com/example/repo/blob/${"a".repeat(40)}/src/main.ts`,
    },
  ],
};
assert.equal((await generateAnalysis(source)).model, "daily-test");
assert.equal(calls, 2);
assert.equal(hasFeedback, true);
console.log("✓ Invalid JSON repaired once with validation feedback");
let report = await usageReport(await readSettings());
assert.ok(report.totals.requests >= 2);
console.log("✓ Both generation and repair counted in usage");
mode = "bad";
const before = calls;
await assert.rejects(() => generateAnalysis(source));
assert.equal(calls - before, 2);
console.log("✓ Persistent invalid output stops after one repair");
mode = "auth";
const authBefore = calls;
await assert.rejects(() => generateAnalysis(source));
assert.equal(calls - authBefore, 1);
console.log(
  "✓ Provider authentication errors are not retried as formatting errors",
);
mode = "overview";
const overviewBefore = overviewCalls;
const edition = await generateOverview("2026-10-30", [
  {
    name: "example/repo",
    headline: "Example repo for daily edition",
    opening: "开发中的许多麻烦，都可以从开源项目里找到细致的解法。",
  },
]);
assert.equal(overviewCalls - overviewBefore, 2);
assert.equal(hasFeedback, true);
assert.equal(edition.title, "开源精选 2026-10-30");
console.log("✓ Invalid overview JSON is repaired once with feedback");
mode = "empty";
const emptyBefore = calls;
await assert.rejects(
  () =>
    planCoreResearch({
      ...source,
      treeComplete: true,
      treeVersion: 6,
      files: [...source.files],
    }),
  (e) => e.code === "AI_TRANSIENT",
);
assert.equal(calls - emptyBefore, 2);
console.log("✓ Transient empty research responses are retried once");
mode = "good";
const settings = await readSettings();
await saveSettings({ ...settings, model: "deepseek-flash" });
await generateAnalysis(source);
assert.equal(lastRequest.thinking?.type, "disabled");
await complete(
  await readSettings(),
  [{ role: "user", content: "test" }],
  undefined,
  undefined,
  "chat",
);
assert.equal(lastRequest.thinking, undefined);
console.log("✓ Daily DeepSeek output controls preserve ordinary chat behavior");
const beforeRead = calls;
let readCount = 0;
analysis.edges[0].evidence = "src/lib.ts";
await generateAnalysis(
  { ...source, files: [...source.files] },
  async (s, file) => {
    readCount++;
    return {
      path: file,
      text: "export const task=()=>1;",
      url: `https://github.com/${s.name}/blob/${s.sha}/${file}`,
    };
  },
);
assert.equal(readCount, 1);
assert.equal(calls - beforeRead, 2);
console.log("✓ Reads referenced code before revising the blog and diagram");
assert.equal(
  sourceLinesFromGitHubHTML(
    '<script type="application/json">' +
      JSON.stringify({ payload: { rawLines: ["first", "second"] } }) +
      "</script>",
  ),
  "first\nsecond",
);
console.log("✓ Extracts official GitHub source data without executing HTML");
await assert.rejects(() => readPublicRepoFile(source, "../private.env"));
console.log(
  "✓ Source reader rejects paths outside the selected repository tree",
);
await generateAnalysis({
  ...source,
  tree: [
    ...source.tree,
    ...Array.from({ length: 14000 }, (_, i) => `src/module${i}.ts`),
  ],
  corePlan: {
    focus: "fixture core flow",
    mainFlow: ["输入", "处理"],
    files: [
      { path: "src/main.ts", role: "入口", why: "处理输入" },
      { path: "src/lib.ts", role: "处理", why: "生成输出" },
    ],
  },
  files: [
    ...source.files,
    {
      path: "src/lib.ts",
      text: "export const task=()=>1",
      url: `https://github.com/${source.name}/blob/${source.sha}/src/lib.ts`,
    },
  ],
});
const bounded = JSON.parse(lastRequest.messages[1].content);
assert.ok(bounded.tree.length <= 124);
assert.ok(bounded.tree.includes("src/main.ts"));
assert.ok(bounded.tree.includes("src/lib.ts"));
console.log(
  "✓ Large repositories keep full stored evidence but bounded writing context",
);
server.close();
console.log("Daily provider regression: 9 checks passed");
