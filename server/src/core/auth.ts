import {
  createHmac,
  timingSafeEqual,
  randomBytes,
  scryptSync,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

export type Role = "admin" | "creator";
export interface Identity {
  username: string;
  role: Role;
}

// Stored outside blog content so credentials and submissions can never be pushed.
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

export function ensureCreatorAccount(): string {
  if (config.creatorPassword) return "";
  const file = path.join(privateDir(), "creator.json");
  if (fs.existsSync(file)) return "";
  const password = randomBytes(18).toString("base64url");
  const salt = newSalt();
  fs.writeFileSync(
    file,
    JSON.stringify({
      password: `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    }),
    { mode: 0o600, flag: "wx" },
  );
  return password;
}

function creatorPassword(): string {
  if (config.creatorPassword) return config.creatorPassword;
  return JSON.parse(
    fs.readFileSync(path.join(privateDir(), "creator.json"), "utf8"),
  ).password;
}

export function authenticate(
  username: string,
  password: string,
): Identity | null {
  const role =
    username === config.adminUsername
      ? "admin"
      : username === config.creatorUsername
        ? "creator"
        : null;
  if (
    !role ||
    !verifyPassword(
      password,
      role === "admin" ? config.password : creatorPassword(),
    )
  )
    return null;
  return { username, role };
}

const COOKIE_NAME = "cms_session";
const TTL_MS = 7 * 24 * 3600 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");
}

export function createSession(identity: Identity): {
  token: string;
  expiresAt: string;
} {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ ...identity, v: 2, exp: Date.now() + TTL_MS }),
    ),
  );
  const token = `${payload}.${sign(payload)}`;
  return { token, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
}

export function verifySession(token: string | undefined): Identity | null {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (extra !== undefined) return null;
  if (!payload || !sig) return null;
  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.v !== 2 || typeof data.exp !== "number" || data.exp <= Date.now())
      return null;
    if (data.role === "admin" && data.username === config.adminUsername)
      return { username: data.username, role: "admin" };
    if (data.role === "creator" && data.username === config.creatorUsername)
      return { username: data.username, role: "creator" };
    return null;
  } catch {
    return null;
  }
}

export function verifyPassword(
  input: string,
  stored = config.password,
): boolean {
  // 支持 "scrypt:<salt>:<hash>" 格式与明文（开发）
  if (stored.startsWith("scrypt:")) {
    const [, salt, hash] = stored.split(":");
    if (!salt || !hash || !/^[a-f0-9]{128}$/i.test(hash)) return false;
    const calc = scryptSync(input, salt, 64).toString("hex");
    return timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
  }
  const a = Buffer.from(input);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const sessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax" as const,
    path: "/",
    maxAge: TTL_MS / 1000,
  },
};

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}
