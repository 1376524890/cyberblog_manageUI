import assert from "node:assert/strict";
import {
  researchPolicy,
  planningPaths,
  invalidDiagramNodes,
} from "../server/src/ai/research-policy.ts";
import { assertCoreDiagram } from "../server/src/ai/research.ts";
import { evidence } from "../server/src/ai/github.ts";
let checks = 0;
function check(name, fn) {
  fn();
  console.log("✓ " + name);
  checks++;
}
const software = [
  "README.md",
  "package.json",
  ".agents/skills/database-core/SKILL.md",
  ".agents/rules/web/architecture.md",
  "src/main.ts",
  "src/router.ts",
  "src/storage.ts",
  "src/editor.ts",
  "tests/main.test.ts",
];
check("Software planning excludes internal agent instructions", () => {
  const p = researchPolicy(software);
  assert.equal(p.kind, "code");
  assert.deepEqual(p.candidates, software.slice(4, 8));
});
const skills = [
  "README.md",
  "plugins/ui/skills/layout/SKILL.md",
  "plugins/ui/skills/colors/SKILL.md",
  "scripts/check.js",
];
check("Skill definitions remain real product modules", () => {
  const p = researchPolicy(skills);
  assert.equal(p.kind, "knowledge");
  assert.ok(p.candidates.includes(skills[1]));
  assert.deepEqual(
    invalidDiagramNodes(skills, [{ path: skills[1], layer: "core" }]),
    [],
  );
});
check("README support node is accepted but not as application core", () => {
  assert.deepEqual(
    invalidDiagramNodes(software, [{ path: "README.md", layer: "support" }]),
    [],
  );
  assert.deepEqual(
    invalidDiagramNodes(software, [{ path: "README.md", layer: "core" }]),
    ["README.md"],
  );
});
check("Tests and internal rules are rejected even as support nodes", () => {
  assert.equal(
    invalidDiagramNodes(software, [
      { path: "tests/main.test.ts", layer: "support" },
      { path: software[2], layer: "core" },
    ]).length,
    2,
  );
});
check("Documentation-only repository can explain its actual content", () => {
  assert.equal(researchPolicy(["README.md"]).kind, "documentation");
  assert.deepEqual(
    invalidDiagramNodes(["README.md"], [{ path: "README.md", layer: "core" }]),
    [],
  );
});
const source = {
  tree: software,
  corePlan: {
    files: [
      { path: "src/main.ts", role: "入口" },
      { path: "src/storage.ts", role: "存储" },
    ],
    mainFlow: ["输入", "存储"],
  },
};
const diagram = {
  nodes: [
    { path: "src/main.ts", layer: "entry" },
    { path: "src/storage.ts", layer: "core" },
    { path: "README.md", layer: "support" },
  ],
  edges: [{ from: 0, to: 1 }],
};
check("Real core graph remains valid with an auxiliary README", () =>
  assert.doesNotThrow(() => assertCoreDiagram(source, diagram)),
);
check("Missing core and disconnected core still block saving", () => {
  assert.throws(() =>
    assertCoreDiagram(source, { nodes: diagram.nodes.slice(0, 1), edges: [] }),
  );
  assert.throws(() => assertCoreDiagram(source, { ...diagram, edges: [] }));
});
check("Large trees produce bounded and diverse planning prompts", () => {
  const tree = Array.from(
    { length: 1400 },
    (_, i) => `packages/editor/src/file${i}.ts`,
  ).concat(["services/chat/src/main.ts", "crates/storage/src/lib.rs"]);
  const p = planningPaths(tree);
  assert.equal(p.candidates.length, 700);
  assert.ok(p.candidates.includes("services/chat/src/main.ts"));
  assert.ok(p.candidates.includes("crates/storage/src/lib.rs"));
});
const original = globalThis.fetch;
let apiRequests = 0,
  htmlRequests = 0;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname === "api.github.com") {
    apiRequests++;
    const body = u.pathname.endsWith("/commits")
      ? [{ sha: "a".repeat(40) }]
      : u.pathname.includes("/git/trees/")
        ? {
            truncated: false,
            tree: [
              {
                type: "blob",
                path: "README.md",
                size: 30,
                sha: "b".repeat(40),
              },
              { type: "blob", path: "go.mod", size: 30, sha: "c".repeat(40) },
              { type: "blob", path: "main.go", size: 30, sha: "d".repeat(40) },
            ],
          }
        : { id: 1, stargazers_count: 7 };
    return new Response(JSON.stringify(body));
  }
  htmlRequests++;
  return new Response(
    '<script type="application/json">' +
      JSON.stringify({
        payload: { blob: { rawLines: ["package main", "func main() {}"] } },
      }) +
      "</script>",
  );
};
try {
  const ev = await evidence({
    name: "fixture/product",
    rank: 1,
    todayStars: 2,
  });
  check(
    "Evidence reuses complete tree and reads official source pages with three API calls",
    () => {
      assert.equal(apiRequests, 3);
      assert.equal(htmlRequests, 3);
      assert.equal(ev.treeComplete, true);
      assert.ok(ev.files.some((f) => f.path === "go.mod"));
    },
  );
} finally {
  globalThis.fetch = original;
}
console.log(`Research policy regression: ${checks} checks passed`);
