<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api.ts";
  import { collections, messageOf, type Collection } from "../lib/content.ts";
  export let admin = false;
  let items: {
    id: string;
    collection: Collection;
    slug: string;
    owner: string;
    data: Record<string, unknown>;
    status: "draft" | "pending" | "approved";
    updatedAt: string;
    reviewNote: string;
  }[] = [];
  let error = "",
    loading = true,
    filter = "",
    collection: Collection = "posts";
  const labels = { draft: "草稿", pending: "待发布", approved: "审核通过" };
  $: visible = items.filter((d) => !filter || d.status === filter);
  async function load() {
    loading = true;
    error = "";
    try {
      items = (await api.get<{ items: typeof items }>("/drafts")).items;
    } catch (e) {
      error = messageOf(e);
    } finally {
      loading = false;
    }
  }
  onMount(load);
</script>

<div class="page-heading">
  <div>
    <div class="eyebrow">CONTENT / REVIEW</div>
    <h1>{admin ? "投稿审核" : "我的草稿"}</h1>
    <p class="muted">
      {admin
        ? "查看创作者投稿，审核通过后前往发布中心统一推送。"
        : "在现有板块创作，保存草稿后提交待发布。"}
    </p>
  </div>
  <div class="action-row">
    <select aria-label="投稿板块" bind:value={collection}
      >{#each Object.entries(collections) as [key, value]}<option value={key}
          >{value.label}</option
        >{/each}</select
    ><a class="button primary" href={`#/drafts/new?collection=${collection}`}
      >＋ 新建草稿</a
    >
  </div>
</div>
{#if error}<div class="err" role="alert">
    {error}<button on:click={load}>重试</button>
  </div>{/if}
<section class="panel">
  <div class="panel-head">
    <h2>{admin ? "审核队列" : "我的投稿"} · {items.length}</h2>
    <select aria-label="稿件状态" bind:value={filter}
      ><option value="">全部状态</option
      >{#each Object.entries(labels) as [key, label]}<option value={key}
          >{label}</option
        >{/each}</select
    >
  </div>
  {#if loading}<div class="empty">
      正在加载稿件…
    </div>{:else if !visible.length}<div class="empty">
      暂无稿件，选择板块开始创作。
    </div>{:else}
    <div class="table-wrap">
      <table>
        <thead
          ><tr
            ><th>标题</th><th>板块</th>{#if admin}<th>创作者</th>{/if}<th
              >状态</th
            ><th>更新时间</th><th></th></tr
          ></thead
        ><tbody>
          {#each visible as d}<tr
              ><td
                ><a href={`#/drafts/${d.id}`}
                  >{String(d.data.title || d.slug)}</a
                >{#if d.reviewNote}<p class="hint">
                    退回：{d.reviewNote}
                  </p>{/if}</td
              ><td>{collections[d.collection].label}</td>{#if admin}<td
                  >{d.owner}</td
                >{/if}<td
                ><span class="badge" class:neutral={d.status !== "pending"}
                  >{labels[d.status]}</span
                ></td
              ><td
                >{new Date(d.updatedAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}</td
              ><td
                ><a href={`#/drafts/${d.id}`}
                  >{d.status === "draft" ? "编辑" : "查看稿件"} →</a
                ></td
              ></tr
            >{/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
