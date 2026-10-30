/** 统一 API 错误：映射为契约规定的 { error: { code, message, details } } */
export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public details?: unknown,
	) {
		super(message);
	}
}
