import { pinyin } from "pinyin-pro";

const CHINESE = /[一-鿿]/;

function cleanSegment(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

/** 单段 slug：中文逐字转拼音（无声调），其余字符保留后清洗。逻辑镜像博客仓库 scripts/new-post.js */
export function slugifySegment(segment: string): string {
	if (!CHINESE.test(segment)) return cleanSegment(segment);
	const chars = [...segment];
	const parts: string[] = [];
	let buf = "";
	for (const ch of chars) {
		if (CHINESE.test(ch)) {
			if (buf) {
				parts.push(buf);
				buf = "";
			}
			parts.push(pinyin(ch, { toneType: "none", type: "array" })[0] as string);
		} else {
			buf += ch;
		}
	}
	if (buf) parts.push(buf);
	return cleanSegment(parts.join("-"));
}

export function slugify(input: string): string {
	return input
		.split("/")
		.map(slugifySegment)
		.join("/")
		.replace(/^-+|-+$/g, "");
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(s: string): boolean {
	return SLUG_RE.test(s);
}
