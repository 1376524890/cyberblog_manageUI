<script lang="ts">
	import { onMount } from "svelte";
	import { api, navigate } from "../lib/api.ts";

	interface Series {
		name: string;
		count: number;
		filePrefix: string | null;
		slugs: string[];
		orders: number[];
	}

	let title = "";
	let slugPreview = "";
	let slugAvailable: boolean | null = null;
	let slugConfirmed = false;
	let manualSlug = "";
	let category = "";
	let tagsInput = "";
	let seriesChoice = "none";
	let seriesNewName = "";
	let meta: {
		categories: { name: string; official: boolean }[];
		officialCategories: string[];
	} | null = null;
	let seriesList: Series[] = [];
	let draft = true;
	let busy = false;
	let error = "";
	let suggestedOrder: number | null = null;
	let suggestedSlugSuffix: string | null = null;

	$: effectiveSlug = manualSlug || slugPreview;

	async function previewSlug() {
		if (!title.trim()) {
			slugPreview = "";
			slugAvailable = null;
			return;
		}
		const res = await api.post<{ slug: string; available: boolean }>(
			"/slug-preview",
			{ title },
		);
		slugPreview = res.slug;
		slugAvailable = res.available;
		if (!res.available) manualSlug = "";
	}

	async function onSeriesChange() {
		suggestedOrder = null;
		suggestedSlugSuffix = null;
		if (seriesChoice === "none") return;
		const s = seriesList.find((x) => x.name === seriesChoice);
		if (!s) return;
		suggestedOrder = (s.orders.length ? Math.max(...s.orders) : 0) + 1;
		if (s.filePrefix) {
			const nums = s.slugs
				.map((sl) => Number(sl.match(/(\d{2,})$/)?.[1] ?? 0))
				.filter((n) => n > 0);
			const next = (nums.length ? Math.max(...nums) : 0) + 1;
			suggestedSlugSuffix = `${s.filePrefix}-${String(next).padStart(2, "0")}`;
		}
	}

	async function create() {
		error = "";
		if (!effectiveSlug || !slugAvailable) {
			error = "请先确认可用的 slug";
			return;
		}
		if (!title.trim()) {
			error = "标题必填";
			return;
		}
		busy = true;
		try {
			const data: Record<string, unknown> = {
				title,
				published: new Date().toISOString().slice(0, 10),
				description: "",
				category: category || null,
				tags: tagsInput
					.split(/[,，]/)
					.map((t) => t.trim())
					.filter(Boolean),
				series: seriesChoice === "new" ? seriesNewName.trim() : seriesChoice === "none" ? "" : seriesChoice,
				seriesOrder: suggestedOrder,
				draft,
			};
			const slug = seriesChoice !== "none" && suggestedSlugSuffix ? suggestedSlugSuffix : effectiveSlug;
			await api.post("/posts", { slug, data, body: `# ${title}\n`, commit: true });
			navigate(`/posts/${slug}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	onMount(async () => {
		const m = await api.get<{
			categories: { name: string; official: boolean }[];
			officialCategories: string[];
		}>("/meta");
		meta = m;
		const s = await api.get<{ items: Series[] }>("/series");
		seriesList = s.items;
	});
</script>

<h2>新建文章</h2>
{#if error}<div class="err">{error}</div>{/if}

<div class="form">
	<label>标题
		<input
			bind:value={title}
			on:input={previewSlug}
			placeholder="支持中文，自动转拼音"
		/>
	</label>

	<label>slug（URL 与文件名，创建后不可改）
		<div class="slug-row">
			<input
				bind:value={manualSlug}
				placeholder={slugPreview}
				disabled={!slugPreview}
			/>
			{#if slugAvailable === false}
				<span class="warn">已被占用</span>
			{:else if slugAvailable === true}
				<span class="ok">可用</span>
			{/if}
		</div>
		{#if slugPreview && !manualSlug}
			<p class="hint">当前将使用：{slugPreview}（拼音自动生成，多音字可能有误——可手动修改）</p>
		{/if}
	</label>

	<label>分类
		<input
			list="cats"
			bind:value={category}
		/>
		<datalist id="cats">
			{#if meta}{#each meta.categories as c (c.name)}<option value={c.name}></option>{/each}{/if}
		</datalist>
	</label>

	<label>标签（逗号分隔）<input bind:value={tagsInput} /></label>

	<fieldset>
		<legend>系列</legend>
		<select bind:value={seriesChoice} on:change={onSeriesChange}>
			<option value="none">不加入系列</option>
			{#each seriesList as s (s.name)}
				<option value={s.name}>{s.name}（{s.count} 篇）</option>
			{/each}
			<option value="new">＋ 新建系列</option>
		</select>
		{#if seriesChoice === "new"}
			<input
				placeholder="新系列名称（同系列文章必须一字不差）"
				bind:value={seriesNewName}
			/>
		{/if}
		{#if suggestedOrder !== null}
			<p class="hint">将作为系列第 {suggestedOrder} 篇{#if suggestedSlugSuffix}，文件名建议 {suggestedSlugSuffix}{/if}</p>
		{/if}
	</fieldset>

	<label class="check"><input
			type="checkbox"
			bind:checked={draft}
		/>创建为草稿（推荐，完成后再发布）</label>

	<div class="actions">
		<button class="ghost" on:click={() => navigate("/posts")}>取消</button>
		<button
			class="primary"
			disabled={busy}
			on:click={create}
		>{busy ? "创建中…" : "创建并编辑"}</button>
	</div>
</div>

<style>
	h2 {
		margin: 0 0 16px;
	}
	.err {
		background: #fef2f2;
		color: #b91c1c;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 8px 12px;
		margin-bottom: 12px;
		font-size: 14px;
	}
	.form {
		background: #fff;
		border-radius: 10px;
		padding: 24px;
		box-shadow: 0 1px 4px rgb(0 0 0 / 6%);
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 640px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: #475569;
	}
	label.check {
		flex-direction: row;
		align-items: center;
	}
	input,
	select {
		padding: 8px 10px;
		border: 1px solid #d0d5dd;
		border-radius: 6px;
		font-size: 14px;
	}
	.slug-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.warn {
		color: #b91c1c;
		font-size: 12px;
	}
	.ok {
		color: #059669;
		font-size: 12px;
	}
	.hint {
		color: #94a3b8;
		font-size: 12px;
		margin: 2px 0 0;
	}
	fieldset {
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	legend {
		font-size: 13px;
		color: #475569;
		padding: 0 4px;
	}
	.actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	button {
		padding: 8px 16px;
		border-radius: 8px;
		border: 1px solid #d0d5dd;
		background: #fff;
		cursor: pointer;
		font-size: 14px;
	}
	.primary {
		background: #2563eb;
		border-color: #2563eb;
		color: #fff;
	}
	.ghost {
		border-color: transparent;
		color: #64748b;
	}
</style>
