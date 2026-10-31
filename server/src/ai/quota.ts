import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Identity } from "../core/auth.ts";
import { registeredAccount } from "../core/accounts.ts";
import { privateDir } from "../core/private-store.ts";
import { actorKey, requestIdentity } from "../core/request-context.ts";
import { assertDiskSpace } from "../core/storage.ts";
import { ApiError } from "../core/errors.ts";

export const USER_DAILY_TOKEN_LIMIT = 3_000_000;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const schema = z.object({
  version: z.literal(1),
  date: z.string(),
  accounts: z.record(
    z.object({ used: integer, reserved: integer, estimated: integer }),
  ),
  reservations: z.record(z.object({ key: z.string(), amount: integer })),
});
type Ledger = z.infer<typeof schema>;
export interface Reservation {
  id: string;
  key: string;
  date: string;
  amount: number;
}
const initialized = new Set<string>();
let tail = Promise.resolve();
const dayOf = (time: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(time);
function filename(date: string) {
  return path.join(privateDir(), "ai-quota", `${date}.json`);
}
async function lock<T>(fn: () => Promise<T>) {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((r) => (release = r));
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
async function save(ledger: Ledger) {
  const content = JSON.stringify(ledger);
  await assertDiskSpace(Buffer.byteLength(content));
  const file = filename(ledger.date),
    temp = `${file}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
}
async function load(date: string): Promise<Ledger> {
  const file = filename(date);
  let ledger: Ledger;
  try {
    ledger = schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (ledger.date !== date) throw new Error();
  } catch (e: any) {
    if (e.code !== "ENOENT")
      throw new ApiError(
        503,
        "AI_QUOTA_UNAVAILABLE",
        "个人额度账目暂时不可用，请稍后重试",
      );
    ledger = { version: 1, date, accounts: {}, reservations: {} };
  }
  if (!initialized.has(file)) {
    // A previous process may have sent these requests upstream. Charge their
    // conservative reservation instead of making a restart reset the allowance.
    if (Object.keys(ledger.reservations).length) {
      for (const r of Object.values(ledger.reservations)) {
        const account = ledger.accounts[r.key];
        if (!account || account.reserved < r.amount)
          throw new ApiError(
            503,
            "AI_QUOTA_UNAVAILABLE",
            "个人额度账目不一致，请联系管理员",
          );
        account.used += r.amount;
        account.estimated += r.amount;
        account.reserved -= r.amount;
      }
      ledger.reservations = {};
      await save(ledger);
    }
    initialized.add(file);
  }
  return ledger;
}
export async function quotaFor(user: Identity, time = new Date()) {
  return lock(async () => {
    const date = dayOf(time),
      ledger = await load(date);
    const account = ledger.accounts[actorKey(user)] ?? {
      used: 0,
      reserved: 0,
      estimated: 0,
    };
    return {
      date,
      timezone: "Asia/Shanghai",
      limit: USER_DAILY_TOKEN_LIMIT,
      ...account,
      remaining: Math.max(
        0,
        USER_DAILY_TOKEN_LIMIT - account.used - account.reserved,
      ),
      resetsAt: new Date(
        new Date(`${date}T00:00:00+08:00`).getTime() + 86400000,
      ).toISOString(),
    };
  });
}
export async function reserveUserTokens(
  amount: number,
): Promise<Reservation | null> {
  const user = requestIdentity.getStore();
  // Scheduled system tasks keep their existing site budget.
  if (!user) return null;
  if (user.userId) {
    const current = registeredAccount(user.username);
    if (
      !current?.active ||
      current.id !== user.userId ||
      current.sessionVersion !== user.sessionVersion
    )
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "账号已停用或会话失效，请重新登录",
      );
  }
  return lock(async () => {
    const date = dayOf(new Date()),
      key = actorKey(),
      ledger = await load(date);
    const account = (ledger.accounts[key] ??= {
      used: 0,
      reserved: 0,
      estimated: 0,
    });
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      account.used + account.reserved + amount > USER_DAILY_TOKEN_LIMIT
    )
      throw new ApiError(
        429,
        "AI_USER_DAILY_LIMIT",
        "今日个人 token 额度不足以完成本次请求；每人每天 300 万 token，北京时间次日零点恢复",
      );
    const ticket = { id: randomUUID(), key, date, amount };
    ledger.reservations[ticket.id] = { key, amount };
    account.reserved += amount;
    await save(ledger);
    return ticket;
  });
}
export async function settleUserTokens(
  ticket: Reservation | null,
  actual: number | null,
) {
  if (!ticket) return;
  return lock(async () => {
    const ledger = await load(ticket.date),
      reservation = ledger.reservations[ticket.id];
    if (!reservation)
      throw new ApiError(
        503,
        "AI_QUOTA_UNAVAILABLE",
        "个人额度预留记录缺失，请联系管理员",
      );
    const account = ledger.accounts[reservation.key];
    const charged =
      actual !== null && Number.isSafeInteger(actual) && actual >= 0
        ? actual
        : reservation.amount;
    account.reserved -= reservation.amount;
    account.used += charged;
    if (actual === null) account.estimated += charged;
    delete ledger.reservations[ticket.id];
    await save(ledger);
  });
}
