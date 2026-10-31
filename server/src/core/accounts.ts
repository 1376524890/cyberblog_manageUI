import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scryptSync, createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.ts";
import { privateDir } from "./private-store.ts";
import { assertDiskSpace } from "./storage.ts";
import { ApiError } from "./errors.ts";

const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  passwordHash: z.string(),
  active: z.boolean(),
  sessionVersion: z.number().int().positive().default(1),
  createdAt: z.string(),
  invitedBy: z.string(),
});
const inviteSchema = z.object({
  id: z.string().uuid(),
  hash: z.string(),
  suffix: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  usedBy: z.string().nullable(),
  usedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
const storeSchema = z.object({
  version: z.literal(1),
  users: z.array(userSchema),
  invites: z.array(inviteSchema),
});
type Store = z.infer<typeof storeSchema>;
const file = () => path.join(privateDir(), "accounts.json");
export function readAccounts(): Store {
  try {
    return storeSchema.parse(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch (e: any) {
    if (e.code === "ENOENT") return { version: 1, users: [], invites: [] };
    throw new ApiError(
      503,
      "ACCOUNTS_UNAVAILABLE",
      "账号数据暂时不可用，请联系管理员",
    );
  }
}
export const registeredAccount = (username: string) =>
  readAccounts().users.find((u) => u.username === username);
let tail = Promise.resolve();
async function mutate<T>(fn: (store: Store) => T): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((r) => (release = r));
  await previous;
  let tmp = "";
  try {
    const store = readAccounts();
    const result = fn(store),
      text = JSON.stringify(store);
    await assertDiskSpace(Buffer.byteLength(text));
    tmp = `${file()}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file());
    return result;
  } finally {
    if (tmp) {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
    release();
  }
}
const digest = (code: string) =>
  createHash("sha256").update(code).digest("hex");
export const registrationSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z][a-z0-9_-]{2,39}$/,
        "账号需为 3–40 位小写字母、数字、下划线或短横线，以字母开头",
      ),
    password: z.string().min(12, "密码至少 12 位").max(128),
    inviteCode: z.string().trim().min(16).max(128),
  })
  .strict();
export async function registerAccount(raw: unknown) {
  const p = registrationSchema.safeParse(raw);
  if (!p.success)
    throw new ApiError(
      422,
      "REGISTRATION_INVALID",
      p.error.issues[0]?.message ?? "请检查注册信息",
    );
  const { username, password, inviteCode } = p.data;
  const salt = randomBytes(16).toString("hex"),
    hash = scryptSync(password, salt, 64).toString("hex");
  return mutate((store) => {
    const invite = store.invites.find((i) => i.hash === digest(inviteCode));
    if (
      !invite ||
      invite.usedAt ||
      invite.revokedAt ||
      Date.parse(invite.expiresAt) <= Date.now()
    )
      throw new ApiError(422, "INVITE_INVALID", "邀请码无效、已使用或已过期");
    if (
      [config.adminUsername, config.creatorUsername].includes(username) ||
      store.users.some((u) => u.username === username)
    )
      throw new ApiError(409, "USERNAME_EXISTS", "该账号已存在，请更换账号");
    if (store.users.length >= 5000)
      throw new ApiError(
        409,
        "ACCOUNT_LIMIT",
        "账号数量达到上限，请联系管理员",
      );
    const user = {
      id: randomUUID(),
      username,
      passwordHash: `scrypt:${salt}:${hash}`,
      active: true,
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
      invitedBy: invite.createdBy,
    };
    store.users.push(user);
    invite.usedBy = username;
    invite.usedAt = user.createdAt;
    return {
      username,
      role: "creator" as const,
      userId: user.id,
      sessionVersion: user.sessionVersion,
    };
  });
}
export async function createInvites(raw: unknown, username: string) {
  const p = z
    .object({
      count: z.number().int().min(1).max(20).default(1),
      days: z.number().int().min(1).max(30).default(7),
    })
    .strict()
    .safeParse(raw);
  if (!p.success)
    throw new ApiError(
      422,
      "INVITE_INVALID",
      "每次生成 1–20 个邀请码，有效期 1–30 天",
    );
  return mutate((store) => {
    // Retain recent audit records while bounding this small account store.
    store.invites = store.invites.filter(
      (i) => Date.parse(i.expiresAt) > Date.now() - 90 * 86400000,
    );
    if (store.invites.length + p.data.count > 10000)
      throw new ApiError(429, "INVITE_LIMIT", "邀请码数量达到上限");
    return Array.from({ length: p.data.count }, () => {
      const code = `CYBER-${randomBytes(18).toString("base64url")}`;
      const invite = {
        id: randomUUID(),
        hash: digest(code),
        suffix: code.slice(-6),
        createdBy: username,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + p.data.days * 86400000).toISOString(),
        usedBy: null,
        usedAt: null,
        revokedAt: null,
      };
      store.invites.push(invite);
      const { hash, ...safe } = invite;
      return { ...safe, code };
    });
  });
}
export async function revokeInvite(id: string) {
  return mutate((store) => {
    const invite = store.invites.find((i) => i.id === id);
    if (!invite) throw new ApiError(404, "NOT_FOUND", "邀请码不存在");
    if (invite.usedAt)
      throw new ApiError(
        409,
        "INVITE_USED",
        "邀请码已使用，请通过账号管理停用账号",
      );
    invite.revokedAt ??= new Date().toISOString();
    return { ok: true };
  });
}
export async function setAccountActive(id: string, active: boolean) {
  return mutate((store) => {
    const user = store.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, "NOT_FOUND", "账号不存在或属于内置账号");
    if (user.active !== active) user.sessionVersion++;
    user.active = active;
    return { ok: true };
  });
}
export function accountOverview() {
  const store = readAccounts();
  return {
    users: [
      {
        id: "builtin-admin",
        username: config.adminUsername,
        role: "admin",
        active: true,
        builtin: true,
      },
      {
        id: "builtin-creator",
        username: config.creatorUsername,
        role: "creator",
        active: true,
        builtin: true,
      },
      ...store.users.map(({ passwordHash, ...user }) => ({
        ...user,
        role: "creator",
        builtin: false,
      })),
    ],
    invites: store.invites.map(({ hash, ...invite }) => ({
      ...invite,
      state: invite.usedAt
        ? "used"
        : invite.revokedAt
          ? "revoked"
          : Date.parse(invite.expiresAt) <= Date.now()
            ? "expired"
            : "available",
    })),
  };
}
