import fs from "node:fs";
import path from "node:path";
import { identityOf } from "../middleware.ts";
import { listCollection } from "../core/content-store.ts";

/** 独立 handler（平铺挂载到 v1 根：GET /api/v1/series、GET /api/v1/meta） */

export async function seriesHandler(c: any): Promise<Response> {
	const posts = await listCollection("posts");
	const map = new Map<string, { name: string; slugs: string[]; orders: number[] }>();
	for (const p of posts) {
		const s = String(p.data.series ?? "").trim();
		if (!s) continue;
		if (!map.has(s)) map.set(s, { name: s, slugs: [], orders: [] });
		const entry = map.get(s)!;
		entry.slugs.push(p.slug);
		if (typeof p.data.seriesOrder === "number") entry.orders.push(p.data.seriesOrder);
	}
	const items = [...map.values()].map((e) => {
		e.slugs.sort();
		e.orders.sort((a, b) => a - b);
		// 从成员文件名推断公共前缀（cpp-tutorial-01 → cpp-tutorial）
		let prefix: string | null = null;
		for (const slug of e.slugs) {
			const m = slug.match(/^(.*)-(\d{2,})$/);
			if (m) {
				prefix = prefix === null || prefix === m[1] ? m[1] : prefix;
			}
		}
		return {
			name: e.name,
			count: e.slugs.length,
			orders: e.orders,
			filePrefix: prefix,
			slugs: e.slugs,
		};
	});
	items.sort((a, b) => b.count - a.count);
	return c.json({ items });
}

export async function metaHandler(c: any): Promise<Response> {
	const posts = await listCollection("posts");
	const catCount = new Map<string, number>();
	const tagCount = new Map<string, number>();
	for (const p of posts) {
		const cat = String(p.data.category ?? "").trim();
		if (cat) catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
		for (const t of (p.data.tags as string[] | undefined) ?? []) {
			const tag = t.trim();
			if (tag) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
		}
	}
	const official = [
		"社团动态",
		"编程教程",
		"网络安全",
		"技术分享",
		"AI 应用",
		"Web 开发",
		"Python 教程",
		"C++ 教程",
		"Java 教程",
	];
	const byCount = (m: Map<string, number>) =>
		[...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
	return c.json({
		categories: byCount(catCount).map((x) => ({ ...x, official: official.includes(x.name) })),
		tags: byCount(tagCount),
		officialCategories: official,
		fields: {
			posts: [
				{ key: "title", type: "string", required: true, label: "标题" },
				{ key: "published", type: "date", required: true, label: "发布日期" },
				{ key: "updated", type: "date", required: false, label: "更新日期" },
				{ key: "description", type: "string", required: false, label: "摘要" },
				{ key: "image", type: "image", required: false, label: "封面图" },
				{ key: "category", type: "string", required: false, enumFrom: "categories", allowCreate: identityOf(c).role === "admin", label: "分类" },
				{ key: "tags", type: "string[]", required: false, suggestFrom: "tags", label: "标签" },
				{ key: "series", type: "string", required: false, enumFrom: "series", allowCreate: identityOf(c).role === "admin", label: "系列" },
				{ key: "seriesOrder", type: "number", required: false, label: "系列序号" },
				{ key: "draft", type: "boolean", required: false, label: "草稿" },
				{ key: "pinned", type: "boolean", required: false, label: "置顶" },
				{ key: "lang", type: "string", required: false, label: "语言" },
				{ key: "author", type: "string", required: false, label: "作者" },
				{ key: "sourceLink", type: "string", required: false, label: "原文链接" },
				{ key: "licenseName", type: "string", required: false, label: "许可证" },
				{ key: "licenseUrl", type: "string", required: false, label: "许可证链接" },
				{ key: "comment", type: "boolean", required: false, label: "允许评论" },
				{ key: "password", type: "string", required: false, secret: true, label: "访问密码" },
				{ key: "passwordHint", type: "string", required: false, label: "密码提示" },
			],
		},
		limits: {
			maxImageMB: 5,
			imageTypes: ["png", "jpg", "jpeg", "webp", "avif", "gif"],
		},
	});
}

