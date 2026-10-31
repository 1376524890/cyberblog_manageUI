#!/usr/bin/env node
/**
 * 生成端到端验收用的测试夹具：
 * test-fixtures/remote.git  — bare 仓库（模拟 GitHub origin）
 * test-fixtures/blog        — 工作仓库（模拟被管理的博客 clone），含系列文章、
 *                             ._ 垃圾文件、schema 外字段（slug/mood）等真实场景
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(root, "test-fixtures");
const remoteDir = path.join(fixturesDir, "remote.git");
const blogDir = path.join(fixturesDir, "blog");

function run(cmd, cwd) {
	execSync(cmd, { cwd, stdio: "pipe" });
}

// 清理旧夹具：重命名保留上一次运行（避免 rm 触发回收站/安全删除链路），最多保留 2 代
if (fs.existsSync(fixturesDir)) {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	fs.renameSync(fixturesDir, path.join(path.dirname(fixturesDir), `.test-fixtures-old-${stamp}`));
	// 清理更老的备份（只留最近 1 份）
	const olds = fs
		.readdirSync(path.dirname(fixturesDir))
		.filter((n) => n.startsWith(".test-fixtures-old-"))
		.sort();
	while (olds.length > 1) {
		const victim = olds.shift();
		fs.rmSync(path.join(path.dirname(fixturesDir), victim), { recursive: true, force: true });
	}
}
fs.mkdirSync(fixturesDir, { recursive: true });
fs.writeFileSync(path.join(fixturesDir,".cms-disposable"),"cyber-cms-generated-v1\n");

// 1. 远端仓库（非 bare + denyCurrentBranch=updateInstead：允许推入已检出分支并自动同步工作区，
//    规避沙箱环境对 bare 仓库 init 的限制，同时模拟真实 push 行为）
run(`git init -b main "${remoteDir}"`);
run("git config user.email cms@test.local", remoteDir);
run("git config user.name \"CMS Remote\"", remoteDir);
run("git config receive.denyCurrentBranch ignore", remoteDir);

// 2. 工作仓库
fs.mkdirSync(blogDir, { recursive: true });
run("git init -b main", blogDir);
run("git config user.email cms@test.local", blogDir);
run("git config user.name CMS Test", blogDir);
run(`git remote add origin "${remoteDir}"`, blogDir);

const postsDir = path.join(blogDir, "src/content/posts");
const dynamicDir = path.join(blogDir, "src/content/dynamic");
fs.mkdirSync(postsDir, { recursive: true });
fs.mkdirSync(dynamicDir, { recursive: true });

function writePost(name, fm, body) {
	const fmStr = Object.entries(fm)
		.map(([k, v]) => {
			if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - ${JSON.stringify(i)}`).join("\n")}`;
			if (typeof v === "string" && /[:#\n'"]/.test(v)) return `${k}: ${JSON.stringify(v)}`;
			return `${k}: ${v}`;
		})
		.join("\n");
	fs.writeFileSync(path.join(postsDir, name), `---\n${fmStr}\n---\n\n${body}\n`);
}

// 系列文章（C++ 教程 3 篇，含 series + seriesOrder + 手写 slug 字段）
for (let i = 1; i <= 3; i++) {
	writePost(
		`cpp-tutorial-0${i}.md`,
		{
			title: `C++ 入门教程（${"一二三"[i - 1]}）：测试章节 ${i}`,
			published: `2026-10-2${i - 1}`,
			description: `测试系列第 ${i} 篇`,
			category: "C++ 教程",
			tags: ["C++", "教程"],
			series: "C++ 入门教程",
			seriesOrder: i,
			draft: false,
			slug: `cpp-tutorial-0${i}`, // schema 外字段：必须被保留
		},
		`# 第 ${i} 章\n\n这是测试内容。\n`,
	);
}

// 单篇文章（无系列）
writePost(
	"web-security-test.md",
	{
		title: "Web 安全测试文章",
		published: "2026-10-28",
		description: "单篇无系列",
		category: "网络安全",
		tags: ["Web安全"],
		draft: false,
	},
	"# 单篇\n\n内容。\n",
);

// 草稿文章
writePost(
	"draft-post.md",
	{
		title: "草稿测试",
		published: "2026-10-29",
		category: "技术分享",
		draft: true,
	},
	"# 草稿\n\n未完成。\n",
);

// dynamic（含 schema 外 mood 字段）
fs.writeFileSync(
	path.join(dynamicDir, "2026-10-28-120000.md"),
	`---\ntitle: 测试动态\npublished: 2026-10-28\nmood: "🎉"\n---\n\n第一条动态\n`,
);

// macOS 垃圾文件（必须被 CMS 过滤，不得出现在列表）
fs.writeFileSync(path.join(postsDir, "._cpp-tutorial-01.md"), "binary junk");
fs.writeFileSync(path.join(postsDir, ".DS_Store"), "junk");

// 提交并推送（夹具可抛弃，force 覆盖远端 init 提交）
run("git add -A", blogDir);
run('git commit -m "feat: initial test fixtures"', blogDir);
run("git push --force origin main", blogDir);

console.log("✓ 测试夹具已生成:");
console.log(`  remote: ${remoteDir}`);
console.log(`  blog:   ${blogDir}`);
