import { createHmac, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";
import { config } from "../config.ts";

/**
 * 单管理员认证：密码 scrypt hash（env）或明文（开发默认）；
 * session = HMAC 签名 token（无状态），cookie 名 cms_session，7 天有效。
 */

const COOKIE_NAME = "cms_session";
const TTL_MS = 7 * 24 * 3600 * 1000;

function b64url(buf: Buffer): string {
	return buf.toString("base64url");
}

function sign(payload: string): string {
	return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

export function createSession(): { token: string; expiresAt: string } {
	const payload = b64url(
		Buffer.from(JSON.stringify({ role: "admin", exp: Date.now() + TTL_MS })),
	);
	const token = `${payload}.${sign(payload)}`;
	return { token, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
}

export function verifySession(token: string | undefined): boolean {
	if (!token) return false;
	const [payload, sig] = token.split(".");
	if (!payload || !sig) return false;
	const expect = sign(payload);
	const a = Buffer.from(sig);
	const b = Buffer.from(expect);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
	try {
		const data = JSON.parse(Buffer.from(payload, "base64url").toString());
		return typeof data.exp === "number" && data.exp > Date.now();
	} catch {
		return false;
	}
}

export function verifyPassword(input: string): boolean {
	const stored = config.password;
	// 支持 "scrypt:<salt>:<hash>" 格式与明文（开发）
	if (stored.startsWith("scrypt:")) {
		const [, salt, hash] = stored.split(":");
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
