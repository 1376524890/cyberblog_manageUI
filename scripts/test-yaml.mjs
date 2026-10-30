import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildFileContent } from "../server/src/core/yaml.ts";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const matter = require("gray-matter");
const { z } = require("zod");
// Match the blog's z.date() contract instead of testing only CMS JSON strings.
const schema = z.object({ published: z.date(), updated: z.date().optional() });
for (const collection of ["posts", "dynamic", "projects"]) {
  const data = { title: "2026-10-30", published: "2026-10-30", tags: ["2026-10-30"] };
  if (collection === "posts") data.updated = "2026-10-31";
  const parsed = matter(buildFileContent(collection, data, { customDate: "2026-10-30" }, "# Test")).data;
  assert.equal(schema.safeParse(parsed).success, true, `${collection}: Astro date schema`);
  assert.equal(parsed.published.toISOString(), "2026-10-30T00:00:00.000Z");
  assert.equal(parsed.title, data.title);
  assert.deepEqual(parsed.tags, data.tags);
  assert.equal(parsed.customDate, "2026-10-30");
  if (collection === "posts") assert.equal(parsed.updated.toISOString(), "2026-10-31T00:00:00.000Z");
}
const page = matter(buildFileContent("spec", { title: "Test" }, { published: "2026-10-30" }, ""));
assert.equal(page.data.published, "2026-10-30", "spec extra fields preserve string types");
console.log("YAML date regression: posts, dynamic, projects and string preservation passed");
