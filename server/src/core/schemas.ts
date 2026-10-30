import { z } from "zod";

/**
 * 博客仓库 src/content.config.ts 的手工镜像（两仓库隔离无法 import）。
 * 变更博客 schema 时必须同步本文件；字段清单可用 `pnpm --dir server run schema-list` 输出比对。
 */

const dateString = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD 格式");

export const postSchema = z.object({
	title: z.string().min(1),
	published: dateString,
	updated: dateString.optional().nullable(),
	draft: z.boolean().optional(),
	description: z.string().optional(),
	image: z.string().optional(),
	tags: z.array(z.string()).optional(),
	category: z.string().nullable().optional(),
	lang: z.string().optional(),
	pinned: z.boolean().optional(),
	author: z.string().optional(),
	sourceLink: z.string().optional(),
	licenseName: z.string().optional(),
	licenseUrl: z.string().optional(),
	comment: z.boolean().optional(),
	password: z.string().optional(),
	passwordHint: z.string().optional(),
	series: z.string().optional(),
	seriesOrder: z.number().int().optional().nullable(),
});

export const dynamicSchema = z.object({
	title: z.string().optional(),
	published: dateString,
	pinned: z.boolean().optional(),
	location: z.string().optional(),
});

export const projectLinkSchema = z.object({
	label: z.string(),
	icon: z.string().optional(),
	value: z.string(),
});

export const projectSchema = z.object({
	title: z.string().min(1),
	published: dateString,
	draft: z.boolean().optional(),
	order: z.number().int().optional().nullable(),
	description: z.string().optional(),
	image: z.string().optional(),
	tags: z.array(z.string()).optional(),
	link: z.array(projectLinkSchema).optional(),
	status: z.string().optional(),
	lang: z.string().optional(),
});

/** spec collection：无 schema，data 原样透传 */
export const specSchema = z.record(z.unknown());

export const schemas = {
	posts: postSchema,
	dynamic: dynamicSchema,
	projects: projectSchema,
	spec: specSchema,
} as const;

export type CollectionName = keyof typeof schemas;

export const COLLECTION_DIRS: Record<CollectionName, string> = {
	posts: "src/content/posts",
	dynamic: "src/content/dynamic",
	projects: "src/content/projects",
	spec: "src/content/spec",
};
