import path from "node:path";
/** Resolve static module references as data; never load or execute repository code. */
export function forwardingOnly(file: { path: string; text: string }) {
  if (!/\.(rs|ts|tsx|js|jsx|mjs|py)$/.test(file.path)) return false;
  const text = file.text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(?:\/\/.*|#(?!\[).*|#\[[^\]]*\])$/gm, "")
    .trim();
  if (!text) return true;
  if (file.path.endsWith(".rs"))
    return (
      /\b(?:mod|use)\b/.test(text) &&
      !text.replace(/(?:pub(?:\([^)]*\))?\s+)?(?:mod|use)\s+[^;]+;/g, "").trim()
    );
  return (
    /\b(?:import|export|from)\b/.test(text) &&
    !text
      .replace(/(?:import|export)\s+[\s\S]*?(?:from\s*)?["'][^"']+["'];?/g, "")
      .replace(/^\s*from\s+[^\n]+\s+import\s+[^\n]+$/gm, "")
      .trim()
  );
}
export function implementationLinks(
  tree: string[],
  file: { path: string; text: string },
) {
  const available = new Set(tree),
    found = new Set<string>();
  const add = (base: string, extensions: string[]) => {
    for (const ext of extensions) {
      const p = path.posix.normalize(base + ext);
      if (available.has(p)) found.add(p);
    }
  };
  if (file.path.endsWith(".rs")) {
    const parent = path.posix.dirname(file.path),
      stem = path.posix.basename(file.path, ".rs");
    const moduleBase = ["lib", "main", "mod"].includes(stem)
      ? parent
      : path.posix.join(parent, stem);
    for (const m of file.text.matchAll(
      /\b(?:pub(?:\([^)]*\))?\s+)?mod\s+([a-z_][a-z0-9_]*)\s*;/g,
    ))
      add(path.posix.join(moduleBase, m[1]), [".rs", "/mod.rs"]);
    const src = file.path.slice(0, file.path.indexOf("/src/") + 5);
    for (const m of file.text.matchAll(
      /\b(?:use|pub\s+use)\s+crate::([a-z0-9_:]+)/g,
    )) {
      const parts = m[1].replace(/::$/, "").split("::");
      for (let n = parts.length; n > 0; n--)
        add(path.posix.join(src, ...parts.slice(0, n)), [".rs", "/mod.rs"]);
    }
  } else {
    for (const m of file.text.matchAll(
      /(?:from\s*|import\s*)["'](\.[^"']+)["']/g,
    )) {
      const base = path.posix.join(path.posix.dirname(file.path), m[1]);
      add(base, [
        "",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        "/index.ts",
        "/index.tsx",
        "/index.js",
      ]);
    }
  }
  return [...found].filter((p) => p !== file.path);
}
