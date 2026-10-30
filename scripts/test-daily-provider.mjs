import assert from "node:assert/strict";
import http from "node:http";
import { generateAnalysis } from "../server/src/ai/daily.ts";
import { saveSettings, readSettings } from "../server/src/ai/settings.ts";
import { usageReport } from "../server/src/ai/usage.ts";
if (!process.env.CMS_AI_ENV_FILE?.includes("test-fixtures/"))
  throw Error("Isolated settings required");
const analysis = {
  intro: "介绍项目用途与模块组织。".repeat(15),
  codeAnalysis: "入口读取本地数据并调用模块，本次仅基于源码样本推导。".repeat(
    15,
  ),
  audience: "适合研究源码组织的开发者。".repeat(5),
  limitations: "没有运行项目或完整审计。".repeat(5),
  nodes: [
    { label: "入口", path: "src/main.ts" },
    { label: "模块", path: "src/lib.ts" },
  ],
  edges: [{ from: 0, to: 1, label: "读取", evidence: "src/main.ts" }],
};
let calls = 0,
  mode = "repair",
  hasFeedback = false;
const server = http.createServer(async (req, res) => {
  let text = "";
  for await (const c of req) text += c;
  const body = JSON.parse(text);
  calls++;
  hasFeedback = body.messages.length > 2;
  if (mode === "auth") {
    res.writeHead(401);
    res.end("{}");
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
assert.equal(report.totals.requests, 2);
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
server.close();
console.log("Daily provider regression: 4 checks passed");
