<script lang="ts">
	import { onMount } from "svelte";
	import { api, ApiClientError } from "../lib/api.ts";

	let password = "";
	let error = "";
	let busy = false;

	onMount(async () => {
		try {
			await api.get("/auth/me");
			location.hash = "/posts";
		} catch {
			/* 未登录，停留登录页 */
		}
	});

	async function login() {
		error = "";
		busy = true;
		try {
			await api.post("/auth/login", { password });
			location.hash = "/posts";
		} catch (e) {
			error = e instanceof ApiClientError ? e.message : "登录失败";
		} finally {
			busy = false;
		}
	}
</script>

<div class="wrap">
	<form
		class="card"
		on:submit|preventDefault={login}
	>
		<h1>CyberBlog 内容管理</h1>
		<p class="sub">管理员登录</p>
		{#if error}
			<div class="error">{error}</div>
		{/if}
		<input
			type="password"
			placeholder="管理密码"
			bind:value={password}
			autofocus
		/>
		<button type="submit" disabled={busy || !password}>
			{busy ? "登录中…" : "登录"}
		</button>
	</form>
</div>

<style>
	.wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f4f6f9;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}
	.card {
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 4px 24px rgb(0 0 0 / 8%);
		padding: 40px;
		width: 320px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	h1 {
		font-size: 20px;
		margin: 0;
		color: #1a1a2e;
	}
	.sub {
		margin: 0 0 8px;
		color: #667;
		font-size: 13px;
	}
	input {
		padding: 10px 12px;
		border: 1px solid #d0d5dd;
		border-radius: 8px;
		font-size: 14px;
	}
	button {
		padding: 10px;
		border: none;
		border-radius: 8px;
		background: #2563eb;
		color: #fff;
		font-size: 14px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.error {
		background: #fef2f2;
		color: #b91c1c;
		border: 1px solid #fecaca;
		padding: 8px 10px;
		border-radius: 6px;
		font-size: 13px;
	}
</style>
