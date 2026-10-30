import path from "node:path";
import fs from "node:fs";

function die(msg: string): never {
	console.error(`[cms:config] ${msg}`);
	process.exit(1);
}

const repoPathRaw = process.env.CMS_REPO_PATH ?? "";

export const config = {
	repoPath: path.resolve(repoPathRaw),
	password: process.env.CMS_ADMIN_PASSWORD ?? "admin123",
	sessionSecret: process.env.CMS_SESSION_SECRET ?? "dev-insecure-secret-change-me",
	port: Number(process.env.PORT ?? 8787),
	host: process.env.HOST ?? "127.0.0.1",
	gitRemote: process.env.CMS_GIT_REMOTE ?? "origin",
	gitBranch: process.env.CMS_GIT_BRANCH ?? "main",
	webDist: path.resolve(
		process.env.CMS_WEB_DIST ??
			path.join(import.meta.dirname, "..", "..", "web", "dist"),
	),
};

export function validateConfig(): void {
	if (!repoPathRaw) {
		die("必须设置 CMS_REPO_PATH（指向专用的博客仓库 clone，严禁指向其他用途目录）");
	}
	if (!fs.existsSync(config.repoPath)) {
		die(`CMS_REPO_PATH 不存在: ${config.repoPath}`);
	}
	if (!fs.existsSync(path.join(config.repoPath, ".git"))) {
		die(`CMS_REPO_PATH 不是 git 仓库: ${config.repoPath}`);
	}
}
