import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
export function privateDir() {
  const gitPath = path.join(config.repoPath, ".git");
  const gitDir = fs.statSync(gitPath).isDirectory()
    ? gitPath
    : path.resolve(
        config.repoPath,
        fs
          .readFileSync(gitPath, "utf8")
          .trim()
          .replace(/^gitdir: /, ""),
      );
  const dir = path.join(gitDir, "cms-private");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
