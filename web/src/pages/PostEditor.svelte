<script lang="ts">
	import { onMount } from "svelte";
	import { api, navigate } from "../lib/api.ts";

	interface PostDetail {
		slug: string;
		data: Record<string, unknown>;
		extraFields: Record<string, unknown>;
		body: string;
		version: { head: string; fileMtimeMs: number };
		postUrl: string | null;
	}

	interface Series {
		name: string;
		count: number;
	}

	let post: PostDetail | null = null;
	let meta: {
		categories: { name: string }[];
		tags: { name: string }[];
	} | null = null;
	let seriesList: Series[] = [];
	let body = "";
	let title = "";
	let published = "";
	let updated = "";
	let description = "";
	let category = "";
	let tagsInput = "";
	let series = "";
	let seriesOrder: number | null = null;
	let draft = false;
	let pinned = false;
	let password = "";
	let showPreview = false;
	let previewHtml = "";
	let saving = false;
	let publishAfter = false;
	let message = "";
	let error = "";
	let images: { name: string; sizeKB: number; refPath: string }[] = [];

	$: slug = post?.slug ?? "";

	async function load(slug: string) {
		error = "";
		post = await api.get<PostDetail>(`/posts/${slug}`);
		const d = post.data;
		title = String(d.title ?? "");
		published = String(d.published ?? "");
		updated = d.updated ? String(d.updated) : "";
		description = String(d.description ?? "");
		category = String(d.category ?? "");
		tagsInput = Array.isArray(d.tags) ? (d.tags as string[]).join(", ") : "";
		series = String(d.series ?? "");
		seriesOrder = typeof d.seriesOrder === "number" ? d.seriesOrder : null;
		draft = Boolean(d.draft);
		pinned = Boolean(d.pinned);
		password = String(d.password ?? "");
		body = post.body;
		await refreshImages();
	}

	async function refreshImages() {
		if (!post) return;
		try {
			const res = await api.get<{ images: typeof images }>(`/posts/${post.slug}/images`);
			images = res.images;
		} catch {
			images = [];
		}
	}

	async function save(publish: boolean) {
		if (!post) return;
		saving = true;
		error = "";
		message = "";
		try {
			const data: Record<string, unknown> = {
				title,
				published,
				description,
				category: category || null,
				tags: tagsInput
					.split(/[,，]/)
					.map((t) => t.trim())
					.filter(Boolean),
				series,
				draft,
				pinned,
			};
			if (updated) data.updated = updated;
			if (seriesOrder !== null) data.seriesOrder = seriesOrder;
			const res = await api.put<{
				version: { head: string; fileMtimeMs: number };
				committed: boolean;
				pendingPush: boolean;
			}>(`/posts/${post.slug}`, {
				data,
				body,
				expected: post.version,
				commit: true,
			});
			post.version = res.version;
			message = res.committed
				? res.pendingPush
					? "已保存并提交，待推送"
					: "已保存并提交"
				: "已保存";
			if (publish) await doPublish();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	async function doPublish() {
		try {
			const res = await api.post<{ pushedCount: number }>("/publish", {});
			message = `已推送 ${res.pushedCount} 个提交，Cloudflare Pages 将自动构建`;
		} catch (e) {
			error = `发布失败: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	async function uploadImage(ev: Event) {
		const input = ev.target as HTMLInputElement;
		if (!input.files?.length || !post) return;
		for (const file of Array.from(input.files)) {
			const form = new FormData();
			form.append("file", file);
			try {
				const r = await api.upload<{ refPath: string }>(`/posts/${post.slug}/images`, form);
				body += `\n![](${r.refPath})\n`;
			} catch (e) {
				error = `图片上传失败: ${e instanceof Error ? e.message : String(e)}`;
			}
		}
		await refreshImages();
		input.value = "";
	}

	async function togglePreview() {
		showPreview = !showPreview;
		if (showPreview) {
			const { marked } = await import("marked");
			previewHtml = await marked.parse(body);
		}
	}

	onMount(async () => {
		const m = await api.get<{ categories: { name: string }[]; tags: { name: string }[] }>(
			"/meta",
		);
		meta = m;
		const s = await api.get<{ items: Series[] }>("/series");
		seriesList = s.items;
		const slug = location.hash.split("/")[2];
		if (slug) await load(slug);
		else navigate("/posts");
	});
</script>

{#if post}
	<div class="head">
		<button class="ghost" on:click={() => navigate("/posts")}>← 返回列表</button>
		<span class="slug">{slug}</span>
		{#if post.postUrl}<span class="url">站点路径: {post.postUrl}</span>{/if}
		<div class="actions">
			<button class="ghost" on:click={togglePreview}>{showPreview ? "编辑" : "预览"}</button>
			<button disabled={saving} on:click={() => save(false)}>保存（不推送）</button>
			<button
				class="primary"
				disabled={saving}
				on:click={() => save(true)}
			>保存并发布</button>
		</div>
	</div>

	{#if message}<div class="msg">{message}</div>{/if}
	{#if error}<div class="err">{error}</div>{/if}

	<div class="layout">
		<div class="meta-form">
			<label>标题<input bind:value={title} /></label>
			<label>发布日期<input
					type="date"
					bind:value={published}
				/></label>
			<label>更新日期<input
					type="date"
					bind:value={updated}
				/></label>
			<label>分类
				<input
					list="cats"
					bind:value={category}
					placeholder="选择或输入新分类"
				/>
				<datalist id="cats">
					{#if meta}{#each meta.categories as c (c.name)}<option value={c.name}></option>{/each}{/if}
				</datalist>
			</label>
			<label>标签（逗号分隔）<input bind:value={tagsInput} /></label>
			<label>系列
				<input
					list="series-list"
					bind:value={series}
					placeholder="选择现有系列或留空"
				/>
				<datalist id="series-list">
					{#each seriesList as s (s.name)}<option value={s.name}></option>{/each}
				</datalist>
			</label>
			<label>系列序号<input
					type="number"
					bind:value={seriesOrder}
				/></label>
			<label>访问密码（留空为公开）<input bind:value={password} /></label>
			<label class="check"><input
					type="checkbox"
					bind:checked={draft}
				/>草稿</label>
			<label class="check"><input
					type="checkbox"
					bind:checked={pinned}
				/>置顶</label>
			<label>摘要<textarea
					rows="3"
					bind:value={description}
				/></label>
		</div>

		<div class="editor-area">
			{#if showPreview}
				<div class="preview">{@html previewHtml}</div>
			{:else}
				<textarea
					class="editor"
					bind:value={body}
					placeholder="Markdown 正文…"
				></textarea>
			{/if}
			<div class="images">
				<label class="upload">
					＋ 上传图片
					<input
						type="file"
						accept="image/*"
						multiple
						on:change={uploadImage}
					/>
				</label>
				{#each images as img (img.name)}
					<span class="img-tag" title="{img.name} {img.sizeKB}KB">{img.name}</span>
				{/each}
			</div>
		</div>
	</div>
{:else}
	<p>加载中…</p>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}
	.slug {
		font-family: monospace;
		color: #64748b;
		font-size: 13px;
	}
	.url {
		color: #94a3b8;
		font-size: 12px;
	}
	.actions {
		margin-left: auto;
		display: flex;
		gap: 8px;
	}
	button {
		padding: 8px 14px;
		border-radius: 8px;
		border: 1px solid #d0d5dd;
		background: #fff;
		cursor: pointer;
		font-size: 14px;
	}
	button:disabled {
		opacity: 0.6;
	}
	.primary {
		background: #059669;
		border-color: #059669;
		color: #fff;
	}
	.ghost {
		border-color: transparent;
		color: #2563eb;
	}
	.msg {
		background: #ecfdf5;
		color: #065f46;
		border: 1px solid #a7f3d0;
		border-radius: 8px;
		padding: 8px 12px;
		margin-bottom: 12px;
		font-size: 14px;
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
	.layout {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 16px;
		align-items: start;
	}
	.meta-form {
		background: #fff;
		border-radius: 10px;
		padding: 16px;
		box-shadow: 0 1px 4px rgb(0 0 0 / 6%);
		display: flex;
		flex-direction: column;
		gap: 10px;
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
	textarea {
		padding: 8px 10px;
		border: 1px solid #d0d5dd;
		border-radius: 6px;
		font-size: 14px;
	}
	.editor-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.editor {
		width: 100%;
		min-height: 60vh;
		font-family: monospace;
		font-size: 14px;
		line-height: 1.7;
		padding: 16px;
		border: 1px solid #d0d5dd;
		border-radius: 10px;
		background: #fff;
	}
	.preview {
		background: #fff;
		border: 1px solid #d0d5dd;
		border-radius: 10px;
		padding: 24px;
		min-height: 60vh;
		line-height: 1.8;
	}
	.preview :global(img) {
		max-width: 100%;
	}
	.preview :global(pre) {
		background: #f4f4f5;
		padding: 12px;
		border-radius: 8px;
		overflow-x: auto;
	}
	.images {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.upload {
		display: inline-flex;
		padding: 6px 12px;
		border: 1px dashed #94a3b8;
		border-radius: 8px;
		cursor: pointer;
		color: #475569;
		font-size: 13px;
	}
	.upload input {
		display: none;
	}
	.img-tag {
		background: #f1f5f9;
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 12px;
		font-family: monospace;
	}
</style>
