import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../core/errors.ts";
import { settingsPath, type AISettings } from "./settings.ts";
export type UsageKind = "chat" | "edit" | "test";
export interface Tokens {
  input: number | null;
  output: number | null;
  total: number | null;
  cached: number | null;
  reasoning: number | null;
}
export interface UsageRecord extends Tokens {
  id: string;
  time: string;
  model: string;
  provider: string;
  kind: UsageKind;
  ok: boolean;
  durationMs: number;
  errorCode: string | null;
}
const directory = path.join(path.dirname(settingsPath), ".runtime");
const count = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
export function normalizeUsage(usage: any): Tokens {
  const input = count(usage?.prompt_tokens ?? usage?.input_tokens);
  const output = count(usage?.completion_tokens ?? usage?.output_tokens);
  return {
    input,
    output,
    total:
      count(usage?.total_tokens) ??
      (input !== null && output !== null ? input + output : null),
    cached: count(
      usage?.prompt_tokens_details?.cached_tokens ??
        usage?.input_tokens_details?.cached_tokens,
    ),
    reasoning: count(
      usage?.completion_tokens_details?.reasoning_tokens ??
        usage?.output_tokens_details?.reasoning_tokens,
    ),
  };
}
export function standardUsage(tokens: Tokens) {
  return {
    prompt_tokens: tokens.input,
    completion_tokens: tokens.output,
    total_tokens: tokens.total,
    prompt_tokens_details: { cached_tokens: tokens.cached },
    completion_tokens_details: { reasoning_tokens: tokens.reasoning },
  };
}
export function aggregateUsages(usages: unknown[]) {
  const list = usages.map(normalizeUsage),
    known = list.filter((u) => u.total !== null);
  const field = (key: keyof Tokens) =>
    list.every((u) => u[key] !== null)
      ? list.reduce((sum, u) => sum + (u[key] ?? 0), 0)
      : null;
  return {
    prompt_tokens: field("input"),
    completion_tokens: field("output"),
    total_tokens: field("total"),
    known_total_tokens: known.reduce((sum, u) => sum + (u.total ?? 0), 0),
    requests: list.length,
    reported_requests: known.length,
    unreported_requests: list.length - known.length,
  };
}
export function chinaDate(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    date,
  );
}
let writer = Promise.resolve();
export async function recordUsage(
  record: Omit<UsageRecord, "id" | "time">,
  time = new Date().toISOString(),
) {
  const previous = writer;
  let release!: () => void;
  writer = new Promise<void>((r) => (release = r));
  await previous;
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const day = chinaDate(new Date(time));
    const file = path.join(directory, `ai-usage-${day.slice(0, 7)}.jsonl`);
    await fs.appendFile(
      file,
      JSON.stringify({ id: crypto.randomUUID(), time, ...record }) + "\n",
      { mode: 0o600 },
    );
  } finally {
    release();
  }
}
export async function readRecords(days = 90) {
  await writer;
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (e: any) {
    if (e.code === "ENOENT") return { items: [] as UsageRecord[], skipped: 0 };
    throw new ApiError(
      503,
      "AI_USAGE_READ",
      "用量记录暂时无法读取，请检查服务器运行目录",
    );
  }
  const cutoff = new Date(Date.now() - (Math.max(days, 32) + 1) * 86400000)
    .toISOString()
    .slice(0, 7);
  const items: UsageRecord[] = [];
  let skipped = 0;
  for (const name of names
    .filter(
      (n) =>
        /^ai-usage-\d{4}-\d{2}\.jsonl$/.test(n) && n.slice(9, 16) >= cutoff,
    )
    .sort()) {
    let text: string;
    try {
      text = await fs.readFile(path.join(directory, name), "utf8");
    } catch {
      throw new ApiError(
        503,
        "AI_USAGE_READ",
        "用量记录暂时无法读取，请检查服务器运行目录",
      );
    }
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const value = JSON.parse(line);
        if (
          !value.time ||
          !Number.isFinite(Date.parse(value.time)) ||
          typeof value.model !== "string" ||
          !value.model ||
          typeof value.ok !== "boolean"
        )
          throw new Error();
        items.push(value);
      } catch {
        skipped++;
      }
    }
  }
  return { items, skipped };
}
export function summarize(items: UsageRecord[]) {
  const sum = (key: keyof Tokens) =>
    items.reduce((n, r) => n + (r[key] ?? 0), 0);
  return {
    requests: items.length,
    successful: items.filter((r) => r.ok).length,
    failed: items.filter((r) => !r.ok).length,
    input: sum("input"),
    output: sum("output"),
    total: sum("total"),
    cached: sum("cached"),
    reasoning: sum("reasoning"),
    reportedRequests: items.filter((r) => r.total !== null).length,
    unreportedRequests: items.filter((r) => r.total === null).length,
    missingInput: items.filter((r) => r.input === null).length,
    missingOutput: items.filter((r) => r.output === null).length,
    averageMs: items.length
      ? Math.round(items.reduce((n, r) => n + r.durationMs, 0) / items.length)
      : 0,
  };
}
export async function usageReport(settings: AISettings, days = 7, model = "") {
  const { items, skipped } = await readRecords(Math.max(days, 32));
  const today = chinaDate(),
    month = today.slice(0, 7);
  const dayOf = (r: UsageRecord) => chinaDate(new Date(r.time));
  const todayStats = summarize(items.filter((r) => dayOf(r) === today)),
    monthStats = summarize(items.filter((r) => dayOf(r).startsWith(month)));
  const dates = Array.from({ length: days }, (_, i) =>
    chinaDate(new Date(Date.now() - (days - i - 1) * 86400000)),
  );
  const selected = items.filter(
    (r) => dates.includes(dayOf(r)) && (!model || r.model === model),
  );
  const byModel = [...new Set(selected.map((r) => r.model))]
    .map((name) => ({
      model: name,
      ...summarize(selected.filter((r) => r.model === name)),
    }))
    .sort((a, b) => b.total - a.total);
  const budget = (used: number, limit: number, unreported: number) => ({
    used,
    limit,
    percent: limit ? Math.round((used / limit) * 100) : null,
    state:
      limit && used >= limit
        ? "exceeded"
        : limit && (used / limit) * 100 >= settings.usageWarnPercent
          ? "warning"
          : "normal",
    unreported,
  });
  return {
    days,
    timezone: "Asia/Shanghai",
    generatedAt: new Date().toISOString(),
    totals: summarize(selected),
    today: todayStats,
    month: monthStats,
    budgets: {
      daily: budget(
        todayStats.total,
        settings.dailyTokenLimit,
        todayStats.unreportedRequests,
      ),
      monthly: budget(
        monthStats.total,
        settings.monthlyTokenLimit,
        monthStats.unreportedRequests,
      ),
      enforce: settings.enforceBudget,
      warnPercent: settings.usageWarnPercent,
    },
    daily: dates.map((date) => ({
      date,
      ...summarize(selected.filter((r) => dayOf(r) === date)),
    })),
    models: byModel,
    modelOptions: [...new Set(items.map((r) => r.model))].sort(),
    recent: selected
      .slice()
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, 50),
    skippedRecords: skipped,
  };
}
export async function ensureBudget(settings: AISettings) {
  if (
    !settings.enforceBudget ||
    (!settings.dailyTokenLimit && !settings.monthlyTokenLimit)
  )
    return;
  const report = await usageReport(settings, 1);
  if (
    report.budgets.daily.state === "exceeded" ||
    report.budgets.monthly.state === "exceeded"
  )
    throw new ApiError(
      429,
      "AI_TOKEN_BUDGET",
      "已达到配置的 token 额度，请到用量监控查看或调整额度后重试",
    );
}
