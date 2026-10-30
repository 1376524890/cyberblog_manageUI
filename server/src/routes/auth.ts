import { Hono } from "hono";
import { z } from "zod";
import { createSession, verifyPassword, sessionCookie } from "../core/auth.ts";
import { ApiError } from "../core/errors.ts";

const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, max = 5, windowMs = 60_000) {
	const now = Date.now();
	const rec = attempts.get(ip);
	if (!rec || rec.resetAt < now) {
		attempts.set(ip, { count: 1, resetAt: now + windowMs });
		return;
	}
	rec.count += 1;
	if (rec.count > max) {
		throw new ApiError(429, "RATE_LIMITED", "尝试过于频繁，请稍后再试");
	}
}

export const authRoutes = new Hono()
	.post("/login", async (c) => {
		const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
		rateLimit(ip);
		const body = z.object({ password: z.string() }).parse(await c.req.json());
		if (!verifyPassword(body.password)) {
			throw new ApiError(401, "UNAUTHORIZED", "密码错误");
		}
		const session = createSession();
		setCookieHeader(c, session.token);
		return c.json({ ok: true, token: session.token, expiresAt: session.expiresAt });
	})
	.post("/logout", (c) => {
		deleteCookieHeader(c);
		return c.json({ ok: true });
	})
	.get("/me", (c) => {
		// authMiddleware 已保证只有有效会话到达此处
		return c.json({ role: "admin", expiresAt: null });
	});

function setCookieHeader(c: any, token: string) {
	const parts = [
		`${sessionCookie.name}=${token}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${sessionCookie.options.maxAge}`,
	];
	if (sessionCookie.options.secure) parts.push("Secure");
	c.header("Set-Cookie", parts.join("; "), { append: true });
}

function deleteCookieHeader(c: any) {
	c.header("Set-Cookie", `${sessionCookie.name}=; Path=/; Max-Age=0`, { append: true });
}
