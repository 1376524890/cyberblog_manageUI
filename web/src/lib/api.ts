/** 极简客户端路由 + API 封装（零依赖，前端可整体替换的契约层） */

export interface ApiErrorBody {
	error: { code: string; message: string; details?: unknown };
}

export class ApiClientError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public details?: unknown,
	) {
		super(message);
	}
}

const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: {
			...(init?.body && !(init.body instanceof FormData)
				? { "Content-Type": "application/json" }
				: {}),
			...init?.headers,
		},
		credentials: "include",
	});
	const text = await res.text();
	const json = text ? (JSON.parse(text) as unknown) : {};
	if (!res.ok) {
		const err = (json as ApiErrorBody).error;
		// 会话过期/未认证：跳回登录页（避免停留在空白主界面）
		if (res.status === 401 && !path.startsWith("/auth/")) {
			location.hash = "/";
			location.reload();
			throw new ApiClientError(401, "UNAUTHORIZED", "登录已过期，请重新登录");
		}
		throw new ApiClientError(
			res.status,
			err?.code ?? "UNKNOWN",
			err?.message ?? res.statusText,
			err?.details,
		);
	}
	return json as T;
}

export const api = {
	get: <T = unknown>(path: string) => request<T>(path),
	post: <T = unknown>(path: string, body?: unknown) =>
		request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
	put: <T = unknown>(path: string, body: unknown) =>
		request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
	del: <T = unknown>(path: string, body?: unknown) =>
		request<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) }),
	upload: <T = unknown>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

/** 路由：hash 路由（#/posts、#/posts/:slug、#/new、#/dynamic） */
export function navigate(hash: string): void {
	location.hash = hash;
}

export function currentRoute(): string {
	return location.hash.slice(1) || "/posts";
}
