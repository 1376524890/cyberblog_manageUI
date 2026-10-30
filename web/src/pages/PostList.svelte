<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api.ts";
  import {
    collections,
    messageOf,
    type Collection,
    type Item,
  } from "../lib/content.ts";
  import Icon from "../components/Icon.svelte";
  export let collection: Collection = "posts";
  let items: Item[] = [],
    total = 0,
    page = 1,
    keyword = "",
    category = "",
    draft = "",
    series = "",
    sort = "published_desc",
    error = "",
    loading = true;
  let meta: {
    categories: { name: string; count: number }[];
    tags: { name: string; count: number }[];
  } | null = null;
  let seriesList: { name: string; count: number }[] = [];
  let tag = "",
    pinned = "",
    memberStatus = "",
    locationName = "";
  $: if (collection === "projects" && sort === "published_desc")
    sort = "order_desc";
  let requestId = 0,
    timer: ReturnType<typeof setTimeout>;
  $: filters = JSON.stringify([
    keyword,
    category,
    draft,
    series,
    sort,
    tag,
    pinned,
    memberStatus,
    locationName,
  ]);
  $: if (filters) {
    page = 1;
  }
  $: query = new URLSearchParams({
    page: String(page),
    pageSize: "15",
    keyword,
    sort,
    ...(category ? { category } : {}),
    ...(draft ? { draft } : {}),
    ...(series ? { series } : {}),
    ...(tag ? { tag } : {}),
    ...(pinned ? { pinned } : {}),
    ...(memberStatus ? { status: memberStatus } : {}),
    ...(locationName ? { location: locationName } : {}),
  }).toString();
  $: schedule(query);
  function schedule(q: string) {
    clearTimeout(timer);
    const id = ++requestId;
    loading = true;
    timer = setTimeout(() => void load(q, id), 220);
  }
  async function load(q: string, id = ++requestId) {
    loading = true;
    error = "";
    try {
      const r = await api.get<{ items: Item[]; pagination: { total: number } }>(
        `/${collection}?${q}`,
      );
      if (id !== requestId) return;
      items = r.items;
      total = r.pagination.total;
      if (page > Math.max(1, Math.ceil(total / 15)))
        page = Math.max(1, Math.ceil(total / 15));
    } catch (e) {
      if (id === requestId) error = messageOf(e);
    } finally {
      if (id === requestId) loading = false;
    }
  }
  function reset() {
    keyword = "";
    category = "";
    draft = "";
    series = "";
    tag = "";
    pinned = "";
    memberStatus = "";
    locationName = "";
    sort = "published_desc";
    page = 1;
  }
  onMount(() => {
    if (collection === "posts")
      void Promise.all([
        api.get<typeof meta>("/meta"),
        api.get<{ items: typeof seriesList }>("/series"),
      ])
        .then(([m, s]) => {
          meta = m;
          seriesList = s.items;
        })
        .catch((e) => (error = messageOf(e)));
    return () => {
      clearTimeout(timer);
      requestId++;
    };
  });
</script>

<div class="page-heading">
  <div>
    <div class="eyebrow">CONTENT / {collection.toUpperCase()}</div>
    <h1>{collections[collection].label}</h1>
    <p class="muted">{collections[collection].hint}</p>
  </div>
  <a
    class="button primary"
    href={collection === "posts" ? "#/new" : `#/${collection}/new`}
    ><Icon name="plus" size={16} />新建{collections[collection].singular}</a
  >
</div>
<div class="panel">
  <div class="toolbar">
    <input
      aria-label="搜索内容"
      type="search"
      placeholder="搜索标题、摘要或文件名…"
      bind:value={keyword}
    />
    {#if collection === "posts"}
      <select aria-label="分类筛选" bind:value={category}
        ><option value="">全部分类</option
        >{#each meta?.categories ?? [] as c}<option value={c.name}
            >{c.name} · {c.count}</option
          >{/each}</select
      >
      <select aria-label="系列筛选" bind:value={series}
        ><option value="">全部系列</option>{#each seriesList as s}<option
            value={s.name}>{s.name}</option
          >{/each}</select
      >
      <select aria-label="标签筛选" bind:value={tag}
        ><option value="">全部标签</option>{#each meta?.tags ?? [] as t}<option
            value={t.name}>{t.name}</option
          >{/each}</select
      >
    {/if}
    {#if collection === "posts" || collection === "projects"}<select
        aria-label="状态筛选"
        bind:value={draft}
        ><option value="">全部状态</option><option value="false"
          >公开内容</option
        ><option value="true">草稿</option></select
      >{/if}
    {#if collection === "projects"}<select
        aria-label="成员状态筛选"
        bind:value={memberStatus}
        ><option value="">全部成员状态</option><option value="member"
          >社团成员</option
        ><option value="在校">在校成员</option><option value="已毕业"
          >毕业校友</option
        ><option value="指导老师">指导老师</option><option value="嘉宾"
          >嘉宾</option
        ><option value="archived">归档</option></select
      >{/if}
    {#if collection === "dynamic"}<select
        aria-label="置顶筛选"
        bind:value={pinned}
        ><option value="">全部动态</option><option value="true">只看置顶</option
        ><option value="false">未置顶</option></select
      >{/if}
    <select aria-label="排序方式" bind:value={sort}
      >{#if collection === "projects"}<option value="order_desc"
          >展示顺序（数值从大到小）</option
        >{/if}<option value="published_desc">日期从新到旧</option><option
        value="published_asc">日期从旧到新</option
      ><option value="title_asc">按标题排序</option></select
    >
    {#if keyword || category || draft || series || tag || pinned || memberStatus}<button
        on:click={reset}>重置</button
      >{/if}
  </div>
  {#if loading}<div
      class="loading-line"
      role="status"
      aria-label="正在加载"
    ></div>{/if}
  {#if error}<div class="empty">
      <div class="err" role="alert">{error}</div>
      <button on:click={() => load(query)}>重试</button>
    </div>
  {:else if !loading && !items.length}<div class="empty">
      <h3>暂无匹配的{collections[collection].singular}</h3>
      <p class="muted">试试调整筛选条件，或开始创建新内容。</p>
      <button on:click={reset}>清除筛选</button>
    </div>
  {:else}
    <div class="table-wrap" aria-busy={loading}>
      <table>
        <thead
          ><tr
            ><th>标题 / 内容</th>{#if collection === "posts"}<th>分类</th><th
                >系列</th
              >{/if}{#if collection === "projects"}<th>身份 / 排序</th><th
                >社交链接</th
              >{/if}{#if collection === "dynamic"}<th>地点</th>{/if}<th>日期</th
            ><th>状态</th><th></th></tr
          ></thead
        ><tbody>
          {#each items as item (item.slug)}<tr
              ><td class="title"
                ><a href={`#/${collection}/${encodeURIComponent(item.slug)}`}
                  >{item.title || item.slug}</a
                ><small
                  >{#if item.pinned}置顶 ·
                  {/if}{#if item.passwordProtected}密码保护 ·
                  {/if}{item.slug}</small
                ></td
              >{#if collection === "posts"}<td
                  ><span class="category">{item.category || "未分类"}</span></td
                ><td
                  >{item.series || "—"}{#if item.seriesOrder != null}<small
                      class="order"
                    >
                      / {String(item.seriesOrder).padStart(2, "0")}</small
                    >{/if}</td
                >{/if}{#if collection === "projects"}<td
                  >{item.status || "未设置"} / {item.order ?? 0}<small
                    style="display:block;margin-top:6px;color:#a5afc3"
                    >{item.tags?.join(" / ")}</small
                  ></td
                ><td>{item.linkCount ?? 0} 个</td
                >{/if}{#if collection === "dynamic"}<td
                  >{item.location || "—"}</td
                >{/if}<td class="date">{item.published || "—"}</td><td
                ><span class="badge" class:draft={item.draft}
                  >{item.draft ? "草稿" : "公开"}</span
                ></td
              ><td
                ><a
                  class="edit-link"
                  href={`#/${collection}/${encodeURIComponent(item.slug)}`}
                  aria-label={`编辑${item.title || item.slug}`}>编辑 ↗</a
                ></td
              ></tr
            >{/each}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="count">共 {total} 条内容</span><button
        aria-label="上一页"
        disabled={loading || page <= 1}
        on:click={() => page--}>←</button
      ><span>{page} / {Math.max(1, Math.ceil(total / 15))}</span><button
        aria-label="下一页"
        disabled={loading || page >= Math.ceil(total / 15)}
        on:click={() => page++}>→</button
      >
    </div>
  {/if}
</div>
<div class="list-note">
  <Icon
    name="check"
    size={14}
  />保存会创建仓库提交；在发布中心推送后，博客将自动构建。
</div>

<style>
  .category {
    background: #f5f6fb;
    padding: 5px 8px;
    border-radius: 4px;
    color: #7b86a2;
    font-size: 11px;
    white-space: nowrap;
  }
  .date {
    white-space: nowrap;
    font-size: 11px;
  }
  .order {
    font-size: 10px;
    color: #a6afc2;
  }
  .edit-link {
    font-size: 11px;
    white-space: nowrap;
    color: #8793b3;
  }
  .list-note {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #9ba6b9;
    font-size: 11px;
    margin-top: 20px;
    line-height: 1.7;
  }
</style>
