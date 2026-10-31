import type { Analysis } from "./daily.ts";
import type { Evidence } from "./github.ts";
import type { ImageAsset } from "../core/content-store.ts";
import { ApiError } from "../core/errors.ts";

export const DAILY_WORKFLOW = {
  version: "grounded-research-resumable-png-v8",
  writingStyle: "详细技术博客",
  figureFormat: "PNG",
  steps: [
    "获取每日榜单",
    "排除历史已介绍项目",
    "规划核心链路",
    "选读关键模块",
    "撰写博客正文",
    "生成架构图片",
    "审阅内容与主流程",
    "检查图文完整性",
    "保存为草稿",
  ],
};
export interface ProjectArticle {
  source: Evidence;
  analysis: Analysis;
  filename: string;
}
export interface BlogDraft {
  slug: string;
  data: Record<string, unknown>;
  body: string;
  assets: ImageAsset[];
  githubRepos: { name: string; id?: number }[];
}
export interface BlogQuality {
  workflowVersion: string;
  passed: boolean;
  projects: number;
  figures: number;
  bodyCharacters: number;
}
const line = (value: string) => value.replace(/[\r\n`]/g, " ").trim();

export function formatProject(article: ProjectArticle, slug: string) {
  const { source: repo, analysis: a, filename } = article;
  const shortName = repo.name.split("/")[1];
  const colon = a.headline.search(/[：:]/);
  let tagline = colon >= 0 ? a.headline.slice(colon + 1) : a.headline;
  if (tagline.toLowerCase().startsWith(shortName.toLowerCase()))
    tagline = tagline.slice(shortName.length).replace(/^[\s—–:：-]+/, "");
  const meta = [`[${repo.name}](https://github.com/${repo.name})`];
  if (repo.language && repo.language !== "未标注")
    meta.push(`\`${line(repo.language)}\``);
  meta.push(`**${repo.stars.toLocaleString("en-US")}** stars`);
  if (repo.todayStars !== null)
    meta.push(`今日 **+${repo.todayStars.toLocaleString("en-US")}**`);
  if (repo.license && !["未标注", "NOASSERTION"].includes(repo.license))
    meta.push(`\`${line(repo.license)}\``);
  const paragraphs = [...a.paragraphs];
  paragraphs.splice(
    Math.min(3, paragraphs.length),
    0,
    `![${repo.name} 代码结构](./images/${slug}/${filename})`,
  );
  return `## ${repo.rank}. ${line(shortName)}\n\n> ${line(tagline)}\n\n${meta.join(" · ")}\n\n${paragraphs.join("\n\n")}`;
}
export function composeBlogDraft(
  date: string,
  projects: ProjectArticle[],
  edition: { lead: string; closing: string },
  assets: ImageAsset[],
): BlogDraft {
  const slug = `github-daily-${date}`;
  const names = projects.map((p) => p.source.name.split("/")[1]).join("、");
  return {
    slug,
    githubRepos: projects.map((p) => ({
      name: p.source.name,
      id: p.source.repositoryId,
    })),
    data: {
      title: `GitHub 每日开源精选 · ${date}`,
      published: date,
      draft: true,
      description: `介绍 ${names} 五个开源项目，讲解实际用途、使用方法与代码结构。`,
      category: "技术分享",
      tags: ["GitHub", "开源", "每日热门", "源码阅读"],
      author: "Cyber先锋社",
      lang: "zh-CN",
    },
    body: `${edition.lead}\n\n${projects.map((p) => formatProject(p, slug)).join("\n\n")}\n\n${edition.closing}\n`,
    assets,
  };
}
export function checkBlogDraft(
  draft: BlogDraft,
  projects: ProjectArticle[],
): BlogQuality {
  const fail = (message: string): never => {
    throw new ApiError(422, "DAILY_QUALITY", message);
  };
  if (projects.length !== 5 || projects.some((p, i) => p.source.rank !== i + 1))
    fail("五个项目的顺序或数量不完整");
  if (draft.data.draft !== true || draft.data.password)
    fail("日报必须保存为无密码草稿");
  const text = draft.body.replace(/```[\s\S]*?```/g, "");
  if ((text.match(/^## /gm) ?? []).length !== 5) fail("博客项目标题结构不完整");
  if (
    /```(?:mermaid|svg|html)\b|本次读取的源码|阅读与复核说明|本文由 CMS|未进行完整审计|未执行仓库代码/i.test(
      draft.body,
    )
  )
    fail("正文仍含不需要的报告模板或嵌入式图表");
  if (
    draft.assets.length !== 5 ||
    new Set(draft.assets.map((a) => a.name)).size !== 5
  )
    fail("架构图片数量或文件名不完整");
  const refs = [
    ...text.matchAll(/!\[[^\]]*\]\(\.\/images\/([^/]+)\/([^)]*\.png)\)/g),
  ];
  if (
    refs.length !== 5 ||
    refs.some(
      (r) => r[1] !== draft.slug || !draft.assets.some((a) => a.name === r[2]),
    )
  )
    fail("正文配图引用与保存图片不一致");
  for (const project of projects) {
    if (!project.source.corePlan || !project.source.semanticReview?.passed)
      fail("核心链路审稿尚未通过，不能保存草稿");
    if (
      project.analysis.paragraphs.length < 5 ||
      project.analysis.paragraphs.join("").length < 750
    )
      fail("项目介绍尚未完整展开");
  }
  for (const asset of draft.assets) {
    const buffer = Buffer.from(asset.data, "base64");
    if (
      buffer.length < 24 ||
      buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      buffer.readUInt32BE(16) < 1000 ||
      buffer.readUInt32BE(20) < 200
    )
      fail("架构图不是有效的高清 PNG");
  }
  return {
    workflowVersion: DAILY_WORKFLOW.version,
    passed: true,
    projects: 5,
    figures: 5,
    bodyCharacters: draft.body.length,
  };
}
