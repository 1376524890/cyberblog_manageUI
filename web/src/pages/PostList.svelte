<script lang="ts">
	import { onMount } from "svelte";
	import { api, navigate } from "../lib/api.ts";

	interface PostItem {
		slug: string;
		title: string;
		published: string | null;
		category: string | null;
		tags: string[];
		series: string;
		seriesOrder: number | null;
		draft: boolean;
		pinned: boolean;
		passwordProtected: boolean;
	}

	let items: PostItem[] = [];
	let total = 0;
	let page = 1;
	const pageSize = 20;
	let keyword = "";
	let categoryFilter = "";
	let draftFilter = "";
	let meta: { categories: { name: string; count: number }[] } | null = null;
	let loading = true;

	$: params = `?page=${page}&pageSize=${pageSize}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ""}${draftFilter ? `&draft=${draftFilter}` : ""}`;

	$: if (params) loadList(params);

	async function loadList(p: string) {
		loading = true;
		try {
			const res = await api.get<{ items: PostItem[]; pagination: { total: number } }>(
				`/posts${p}`,
			);
			items = res.items;
			total = res.pagination.total;
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		const m = await api.get<{ categories: { name: string; count: number }[] }>("/meta");
		meta = m;
	});

	function totalPages(): number {
		return Math.max(1, Math.ceil(total / pageSize));
	}
</script>

<div class="toolbar">
	<input
		class="search"
		placeholder="搜索标题/摘要…"
		bind:value={keyword}
	/>
	<select bind:value={categoryFilter}>
		<option value="">全部分类</option>
		{#if meta}
			{#each meta.categories as c (c.name)}
				<option value={c.name}>{c.name} ({c.count})</option>
			{/each}
		{/if}
	</select>
	<select bind:value={draftFilter}>
		<option value="">全部状态</option>
		<option value="false">已发布</option>
		<option value="true">草稿</option>
	</select>
	<button
		class="primary"
		on:click={() => navigate("/new")}
	>＋ 新建文章</button>
</div>

{#if loading}
	<p class="loading">加载中…</p>
{:else}
	<table>
		<thead>
			<tr>
				<th>标题</th>
				<th>分类</th>
				<th>系列</th>
				<th>日期</th>
				<th>状态</th>
			</tr>
		</thead>
		<tbody>
			{#each items as item (item.slug)}
				<tr
					class="row"
					on:click={() => navigate(`/posts/${item.slug}`)}
				>
					<td class="title">
						{#if item.pinned}📌{/if}
						{#if item.passwordProtected}🔒{/if}
						{item.title || item.slug}
					</td>
					<td>{item.category ?? "—"}</td>
					<td>
						{#if item.series}{item.series}{#if item.seriesOrder !== null} #{item.seriesOrder}{/if}{/if}
					</td>
					<td>{item.published ?? "—"}</td>
					<td>
						<span class:draft={item.draft} class="badge">
							{item.draft ? "草稿" : "已发布"}
						</span>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<div class="pager">
		<button disabled={page <= 1} on:click={() => (page -= 1)}>上一页</button>
		<span>{page} / {totalPages()}</span>
		<button disabled={page >= totalPages()} on:click={() => (page += 1)}>下一页</button>
		<span class="count">共 {total} 篇</span>
	</div>
{/if}

<style>
	.toolbar {
		display: flex;
		gap: 8px;
		margin-bottom: 16px;
		align-items: center;
	}
	.search {
		flex: 1;
		max-width: 320px;
	}
	.primary {
		margin-left: auto;
		background: #2563eb;
		color: #fff;
		border: none;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		background: #fff;
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 1px 4px rgb(0 0 0 / 6%);
	}
	th,
	td {
		text-align: left;
		padding: 10px 12px;
		font-size: 14px;
		border-bottom: 1px solid #f0f0f0;
	}
	th {
		background: #f8fafc;
		color: #475569;
		font-weight: 500;
	}
	.row {
		cursor: pointer;
	}
	.row:hover {
		background: #f0f7ff;
	}
	.title {
		font-weight: 500;
	}
	.badge {
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 12px;
		background: #dcfce7;
		color: #166534;
	}
	.badge.draft {
		background: #fef9c3;
		color: #854d0e;
	}
	.pager {
		display: flex;
		gap: 12px;
		align-items: center;
		margin-top: 16px;
		color: #64748b;
		font-size: 14px;
	}
	.count {
		margin-left: auto;
	}
	.loading {
		color: #64748b;
	}
</style>
