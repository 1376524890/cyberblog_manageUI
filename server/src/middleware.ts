import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "./config.ts";
import { ApiError } from "./core/errors.ts";
import { verifySession, sessionCookie } from "./core/auth.ts";

/** 认证中间件：cookie 或 Bearer 双轨 */
export function authMiddleware() {
	return async (c: any, next: () => Promise<void>) => {
		const cookieToken = getCookie(c, sessionCookie.name);
		const header = c.req.header("Authorization");
		const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
		const token = bearer ?? cookieToken;
		if (!token || !verifySession(token)) {
			throw new ApiError(401, "UNAUTHORIZED", "未认证或会话过期");
		}
		await next();
	};
}

/** 统一 ApiError → 契约错误结构 */
export function errorHandler() {
	return async (err: unknown, c: any) => {
		if (err instanceof ApiError) {
			return c.json(
				{ error: { code: err.code, message: err.message, details: err.details ?? null } },
				err.status as any,
			);
		}
		const message = err instanceof Error ? err.message : String(err);
		console.error("[cms:unhandled]", err);
		return c.json({ error: { code: "INTERNAL", message, details: null } }, 500);
	};
}

export function requireRepo(): void {
	// config.validateConfig 已在启动时校验；此处防御性兜底
	if (!config.repoPath) throw new ApiError(500, "INTERNAL", "CMS_REPO_PATH 未配置");
}
