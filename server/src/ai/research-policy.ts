/** Files used to explain the product, separate from instructions used to develop it. */
export const RESEARCH_POLICY_VERSION = 6;
const testFile = (p: string) =>
  /(^|\/)(tests?|fixtures|__tests__|node_modules|vendor|dist|build)\//i.test(
    p,
  ) || /\.(test|spec)\./i.test(p);
const manifest = (p: string) =>
  /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|tsconfig[^/]*\.json|README[^/]*)$/i.test(
    p,
  );
const developerRules = (p: string) =>
  /(^|\/)(\.(?:agents|claude|cursor|github)|AGENTS\.md|CLAUDE\.md)(\/|$)/i.test(
    p,
  );
const codeFile = (p: string) =>
  !testFile(p) &&
  !developerRules(p) &&
  !/\.d\.ts$|\.min\./i.test(p) &&
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|vue|svelte|sh|kt|swift|rb|ex|exs)$/i.test(
    p,
  );
const skillFile = (p: string) =>
  !testFile(p) &&
  !manifest(p) &&
  /(^|\/)(skills|prompts|commands|rules)\/.*\.md$/i.test(p);
export interface ResearchPolicy {
  kind: "code" | "knowledge" | "documentation";
  candidates: string[];
}
export function researchPolicy(tree: string[]): ResearchPolicy {
  const code = tree.filter(codeFile);
  const knowledge = tree.filter((p) => skillFile(p) && !developerRules(p));
  const productCode = code.filter(
    (p) => !/(^|\/)(skills|scripts|prompts|commands|rules)\//i.test(p),
  );
  if (knowledge.length && productCode.length < 4)
    return { kind: "knowledge", candidates: [...knowledge, ...code] };
  if (code.length) return { kind: "code", candidates: code };
  const docs = tree.filter(
    (p) =>
      !testFile(p) && !developerRules(p) && /\.md$/i.test(p) && !manifest(p),
  );
  if (docs.length) return { kind: "documentation", candidates: docs };
  const fallback = tree.filter((p) => !testFile(p) && /\.md$/i.test(p));
  return { kind: "documentation", candidates: fallback };
}
export function planningPaths(tree: string[]): ResearchPolicy {
  const policy = researchPolicy(tree);
  // Balance packages/services rather than spending the entire prompt on one large directory.
  const score = (p: string) =>
    (/(^|\/)(src|app|apps|services|crates|core|lib|packages)\//.test(p)
      ? 0
      : 30) +
    (/(^|\/)(main|index|app|server|router|agent|pipeline|engine)\./.test(p)
      ? -10
      : 0) +
    p.split("/").length;
  const sorted = [...policy.candidates].sort(
    (a, b) => score(a) - score(b) || a.localeCompare(b),
  );
  const groups = new Map<string, string[]>();
  for (const p of sorted) {
    const parts = p.split("/");
    const key = parts.slice(0, 2).join("/");
    const bucket = groups.get(key) ?? [];
    bucket.push(p);
    groups.set(key, bucket);
  }
  const paths: string[] = [];
  while (paths.length < 700) {
    let added = false;
    for (const bucket of groups.values()) {
      const p = bucket.shift();
      if (p) {
        paths.push(p);
        added = true;
      }
      if (paths.length === 700) break;
    }
    if (!added) break;
  }
  return { ...policy, candidates: paths };
}
export function invalidDiagramNodes(
  tree: string[],
  nodes: { path: string; layer: string }[],
): string[] {
  const policy = researchPolicy(tree),
    allowed = new Set(policy.candidates);
  return nodes
    .filter((n) => {
      if (
        testFile(n.path) ||
        (developerRules(n.path) && policy.kind === "code")
      )
        return true;
      if (allowed.has(n.path)) return false;
      return !(manifest(n.path) && n.layer === "support");
    })
    .map((n) => n.path);
}
