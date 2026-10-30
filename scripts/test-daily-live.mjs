import fs from "node:fs/promises";
import path from "node:path";
import {
  DailyService,
  authorReviewedProject,
  generateOverview,
  dayInShanghai,
} from "../server/src/ai/daily.ts";
import { trending, evidence } from "../server/src/ai/github.ts";

if (process.env.CMS_DAILY_LIVE_TEST !== "1")
  throw Error("Set CMS_DAILY_LIVE_TEST=1 to authorize live model requests");
const root = path.resolve(process.env.CMS_DAILY_QA_DIR ?? "");
if (!root.includes("daily-auto-qa"))
  throw Error("Use a dedicated daily-auto-qa output directory");
const date = process.env.CMS_DAILY_QA_DATE ?? dayInShanghai();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("Invalid QA date");
const dir = path.join(root, date);
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
if (process.env.CMS_DAILY_QA_SEED) {
  const seed = path.resolve(process.env.CMS_DAILY_QA_SEED);
  for (const name of [
    "ranking.json",
    ...Array.from({ length: 5 }, (_, i) => `${i + 1}-source-v5.json`),
  ]) {
    try {
      await fs.access(path.join(dir, name));
    } catch {
      await fs.copyFile(path.join(seed, name), path.join(dir, name));
    }
  }
}
let clock = new Date(`${date}T08:00:00+08:00`);
const runner = new DailyService(root, {
  history: async () => [],
  trending,
  evidence,
  generate: authorReviewedProject,
  overview: generateOverview,
  now: () => clock,
});
runner.setWriter(async (draft) => {
  await fs.writeFile(
    path.join(root, "validated-draft.json"),
    JSON.stringify(draft),
    { mode: 0o600 },
  );
  console.log(
    "Validated draft captured; no production content was written",
    draft.slug,
    draft.assets.length,
  );
});
await runner.configure(true);
for (let attempt = 0; attempt < 3; attempt++) {
  await runner.tick();
  await runner.wait();
  const state = await runner.status();
  console.log(JSON.stringify(state.runs[0]));
  if (state.runs[0]?.state === "done") break;
  clock = new Date(clock.getTime() + 11 * 60000);
}
const final = await runner.status();
if (final.runs[0]?.state !== "done" || !final.runs[0]?.quality?.passed)
  process.exitCode = 1;
