<script lang="ts">
	import { onMount } from "svelte";
	import { currentRoute, api } from "./lib/api.ts";
	import Login from "./pages/Login.svelte";
	import PostList from "./pages/PostList.svelte";
	import PostEditor from "./pages/PostEditor.svelte";
	import PostNew from "./pages/PostNew.svelte";

	let route = currentRoute();
	let authed = false;
	let checked = false;
	let pendingPushCount = 0;
	let pubMsg = "";

	async function refreshGitStatus() {
		try {
			const st = await api.get<{ pendingPushCount: number }>("/git/status");
			pendingPushCount = st.pendingPushCount;
		} catch {
			/* ignore */
		}
	}

	async function publishPending() {
		pubMsg = "";
		try {
			const r = await api.post<{ pushedCount: number }>("/publish", {});
			pubMsg = `已推送 ${r.pushedCount} 个提交`;
			pendingPushCount = 0;
		} catch (e) {
			pubMsg = `失败: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	function onHashChange() {
		route = currentRoute();
	}

	onMount(() => {
		window.addEventListener("hashchange", onHashChange);
		void checkAuth();
		const timer = setInterval(refreshGitStatus, 30_000);
		return () => {
			clearInterval(timer);
			window.removeEventListener("hashchange", onHashChange);
		};
	});

	async function checkAuth(): Promise<void> {
		try {
			await api.get("/auth/me");
			authed = true;
			await refreshGitStatus();
		} catch {
			authed = false;
		} finally {
			checked = true;
		}
	}
</script>

{#if !checked}
	<p class="boot">加载中…</p>
{:else if !authed}
	<Login />
{:else}
	<div class="shell">
		<header>
			<span class="brand">CyberBlog 内容管理</span>
			<nav>
				<a href="#/posts">文章</a>
				<a href="#/new">新建</a>
			</nav>
			<div class="git-bar">
				{#if pendingPushCount > 0}
					<button on:click={publishPending}>待推送 {pendingPushCount} 提交 · 点击推送</button>
				{:else}
					<span class="clean">✓ 已同步</span>
				{/if}
				{#if pubMsg}<span class="pub-msg">{pubMsg}</span>{/if}
			</div>
		</header>
		<main>
			{#if route === "/posts"}
				<PostList />
			{:else if route === "/new"}
				<PostNew />
			{:else if route.startsWith("/posts/")}
				<PostEditor />
			{:else}
				<PostList />
			{/if}
		</main>
	</div>
{/if}

<style>
	:global(:root) {
		color-scheme: light;
	}
	:global(body) {
		margin: 0;
		background: #f4f6f9;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		color: #1e293b;
	}
	.boot {
		text-align: center;
		color: #64748b;
		margin-top: 60px;
	}
	.shell {
		max-width: 1200px;
		margin: 0 auto;
		padding: 16px 20px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 12px 0;
		margin-bottom: 8px;
		border-bottom: 1px solid #e2e8f0;
	}
	.brand {
		font-weight: 700;
		color: #1a1a2e;
	}
	nav {
		display: flex;
		gap: 16px;
	}
	nav a {
		color: #475569;
		text-decoration: none;
		font-size: 14px;
	}
	nav a:hover {
		color: #2563eb;
	}
	.git-bar {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	.git-bar button {
		background: #fef3c7;
		border: 1px solid #fcd34d;
		color: #92400e;
		border-radius: 8px;
		padding: 6px 12px;
		cursor: pointer;
		font-size: 13px;
	}
	.clean {
		color: #059669;
	}
	.pub-msg {
		color: #64748b;
	}
	main {
		padding: 8px 0 40px;
	}
</style>
