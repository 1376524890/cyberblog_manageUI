import type { CollectionName } from "./schemas.ts";

/**
 * 受控 YAML 序列化：不用 js-yaml dump（避免键序重排/引号风格漂移/日期变 ISO 全格式）。
 * 规则：
 * - 输出顺序 = schema 字段顺序，未知键（mood/slug 等）追加在末尾原样保留
 * - Date 一律格式化为 YYYY-MM-DD 字符串
 * - 字符串仅在必要时加引号（特殊字符/数字样/布尔样/前后空格/空串）
 */

const FIELD_ORDER: Record<CollectionName, string[]> = {
	posts: [
		"title",
		"published",
		"updated",
		"description",
		"image",
		"tags",
		"category",
		"lang",
		"pinned",
		"author",
		"sourceLink",
		"licenseName",
		"licenseUrl",
		"comment",
		"password",
		"passwordHint",
		"series",
		"seriesOrder",
	],
	dynamic: ["title", "published", "pinned", "location"],
	projects: [
		"title",
		"published",
		"draft",
		"order",
		"description",
		"image",
		"tags",
		"link",
		"status",
		"lang",
	],
	spec: [],
};

function needsQuotes(s: string): boolean {
	if (s === "") return true;
	if (/^\s|\s$/.test(s)) return true;
	if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return true;
	if (/^(true|false|null|yes|no|on|off)$/i.test(s)) return true;
	if (/^[-+]?\.?\d/.test(s)) return true;
	if (s.includes(": ") || s.includes(" #")) return true;
	if (/[\n\r]/.test(s)) return true;
	return false;
}

function scalar(v: unknown): string {
	if (v === null) return "~";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "number") return String(v);
	if (v instanceof Date) return formatDate(v);
	if (typeof v === "string") {
		return needsQuotes(v) ? `'${v.replace(/'/g, "''")}'` : v;
	}
	return JSON.stringify(v);
}

export function formatDate(d: Date | string): string {
	const dt = d instanceof Date ? d : new Date(`${d}T00:00:00+08:00`);
	const y = dt.getFullYear();
	const m = String(dt.getMonth() + 1).padStart(2, "0");
	const day = String(dt.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function stringifyFrontmatter(
	collection: CollectionName,
	data: Record<string, unknown>,
	extra: Record<string, unknown>,
): string {
	const order = FIELD_ORDER[collection];
	const lines: string[] = [];
	const used = new Set<string>();
	const emit = (key: string, value: unknown) => {
		if (value === undefined) return;
		if (value === null && key !== "category" && key !== "updated") return;
		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`${key}: []`);
			} else {
				lines.push(`${key}:`);
				for (const item of value) lines.push(`  - ${scalar(item)}`);
			}
			return;
		}
		lines.push(`${key}: ${scalar(value)}`);
	};
	for (const key of order) {
		if (key in data) {
			emit(key, data[key]);
			used.add(key);
		}
	}
	for (const [key, value] of Object.entries(extra)) {
		if (used.has(key)) continue;
		emit(key, value);
	}
	return lines.join("\n");
}

/** 组装完整 md 文件：front matter + 正文 */
export function buildFileContent(
	collection: CollectionName,
	data: Record<string, unknown>,
	extra: Record<string, unknown>,
	body: string,
): string {
	const fm = stringifyFrontmatter(collection, data, extra);
	return `---\n${fm}\n---\n\n${body}`;
}
