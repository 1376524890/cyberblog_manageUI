import { simpleGit } from "simple-git";
import { config } from "../config.ts";
import { ApiError } from "./errors.ts";

/** git 发布器：commit 与 push 解耦；失败保留本地提交；绝不 reset --hard */

export interface GitStatusInfo {
	head: string;
	branch: string;
	clean: boolean;
	pendingPushCount: number;
	pendingCommits: { sha: string; message: string; time: string }[];
	lastPushedSha: string | null;
	remoteAhead: boolean;
	healthy: boolean;
	lockedReason: string | null;
}

function git() {
	return simpleGit({ baseDir: config.repoPath });
}

export async function status(): Promise<GitStatusInfo> {
	const g = git();
	const [head, branch, st] = await Promise.all([
		g.log(["-1", "--format=%H"]).catch(() => null),
		g.branchLocal().catch(() => null),
		g.status().catch(() => null),
	]);
	const headSha = head?.latest?.hash ?? "";
	let pending: { sha: string; message: string; time: string }[] = [];
	let lastPushed: string | null = null;
	let remoteAhead = false;
	let trackingHealthy = true;
	try {
		const tracking = await g.raw(["rev-list", "--left-right", "--count", `${config.gitRemote}/${config.gitBranch}...HEAD`]);
		const [behind, ahead] = tracking.trim().split(/\s+/).map(Number);
		remoteAhead = behind > 0;
		if (ahead > 0) {
			const log = await g.log([`${config.gitRemote}/${config.gitBranch}..HEAD`]);
			pending = log.all.map((c) => ({ sha: c.hash, message: c.message, time: c.date }));
		}
		const pushed = await g.raw(["rev-parse", `${config.gitRemote}/${config.gitBranch}`]).catch(() => null);
		lastPushed = pushed?.trim() || null;
	} catch {
		trackingHealthy = false;
	}
	return {
		head: headSha,
		branch: branch?.current ?? config.gitBranch,
		clean: st ? st.isClean() : false,
		pendingPushCount: pending.length,
		pendingCommits: pending,
		lastPushedSha: lastPushed,
		remoteAhead,
		healthy: !!head && !!branch && !!st && trackingHealthy,
		lockedReason: !trackingHealthy ? "无法读取远端跟踪分支，请检查仓库配置" : (!head || !st ? "仓库读取失败" : null),
	};
}

export interface CommitResult {
	committed: boolean;
	commitSha: string | null;
	pendingPush: boolean;
}

/** commit 指定文件（若工作区该文件有变更）；返回新 HEAD。nothing-to-commit 时返回当前 HEAD */
export async function commitPaths(
	paths: string[],
	message: string,
): Promise<CommitResult> {
	const g = git();
	const st = await g.status();
	const relPaths = st.files.map((f) => f.path);
	const changed = paths.filter((p) =>
		relPaths.some((rp) => rp === p || rp.startsWith(`${p}/`) || p.startsWith(`${rp.replace(/\/$/, "")}/`)),
	);
	let head: string | null = null;
	if (changed.length > 0) {
		await g.add(changed);
		const cm = await g.commit(message, changed);
		head = cm.commit || null;
	}
	const pending = await hasPendingPush();
	return { committed: head !== null, commitSha: head, pendingPush: pending };
}

async function hasPendingPush(): Promise<boolean> {
	try {
		const g = git();
		const r = await g.raw(["rev-list", "--count", `${config.gitRemote}/${config.gitBranch}..HEAD`]);
		return Number(r.trim()) > 0;
	} catch {
		return false;
	}
}

/** 发布：fetch → remoteAhead 则 pull --rebase（冲突 abort）→ push */
export async function publish(): Promise<{ pushedSha: string; pushedCount: number }> {
	const g = git();
	try {
		const st = await g.status();
		if (!st.isClean()) throw new ApiError(409,"GIT_REPO_DIRTY","工作区存在未提交修改，请先保存内容及图片再发布");
		await g.fetch(config.gitRemote);
		const tracking = await g.raw([
			"rev-list",
			"--left-right",
			"--count",
			`${config.gitRemote}/${config.gitBranch}...HEAD`,
		]);
		const [behind, ahead] = tracking.trim().split(/\s+/).map(Number);
		if (behind > 0) {
			try {
				await g.pull(config.gitRemote, config.gitBranch, { "--rebase": "true" });
			} catch {
				await g.rebase(["--abort"]).catch(() => {});
				throw new ApiError(503, "GIT_REPO_LOCKED", "rebase 冲突，已中止，请人工处理仓库");
			}
		}
		await g.push(config.gitRemote, config.gitBranch);
		const head = await g.log(["-1", "--format=%H"]);
		return { pushedSha: head.latest?.hash ?? "", pushedCount: ahead };
	} catch (e) {
		if (e instanceof ApiError) throw e;
		const msg = e instanceof Error ? e.message : String(e);
		throw new ApiError(502, "GIT_PUSH_FAILED", `push 失败: ${msg.slice(0, 300)}`);
	}
}

/** 校验 commit message 符合 Conventional Commits */
export function isValidCommitMessage(msg: string): boolean {
	return /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/.test(
		msg.trim(),
	);
}
