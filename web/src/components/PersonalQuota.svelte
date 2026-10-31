<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api.ts";
  export let compact = false;
  let quota: {
    used: number;
    reserved: number;
    remaining: number | null;
    limit: number | null;
    unlimited: boolean;
    estimated: number;
  } | null = null;
  let error = "";
  async function refresh() {
    try {
      quota = await api.get("/ai/quota");
      error = "";
    } catch {
      error = "额度暂时无法读取";
    }
  }
  onMount(() => {
    void refresh();
    window.addEventListener("cms:ai-used", refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("cms:ai-used", refresh);
    };
  });
</script>

{#if compact}<small class="quota-inline"
    >{quota
      ? quota.unlimited
        ? `管理员不限额 · 今日已用 ${quota.used.toLocaleString()} token`
        : `今日剩余 ${quota.remaining?.toLocaleString()} / ${quota.limit?.toLocaleString()} token`
      : error || "正在读取个人额度…"}</small
  >
{:else}<section class="panel quota">
    <div class="panel-head"><h2>我的每日额度</h2></div>
    <div class="panel-body">
      {#if quota}<strong
          >{quota.unlimited
            ? "不限额"
            : quota.remaining?.toLocaleString()}</strong
        ><span
          >{quota.unlimited
            ? "管理员不受 token 额度限制"
            : `剩余 token / 每日 ${quota.limit?.toLocaleString()}`}</span
        >
        {#if !quota.unlimited && quota.limit !== null}<progress
            max={Math.max(1, quota.limit)}
            value={Math.min(quota.limit, quota.used + quota.reserved)}
            aria-label="今日 token 用量"
          ></progress>{/if}<small
          >今日已用 {quota.used.toLocaleString()}{#if quota.reserved}
            · 处理中预留 {quota.reserved.toLocaleString()}{/if}</small
        >{#if quota.estimated}<small
            >其中 {quota.estimated.toLocaleString()} 为未上报用量的保守估算。</small
          >{/if}<small>包含输入与输出，北京时间每日 00:00 重置。</small
        >{:else}<p class="hint">{error || "正在读取个人额度…"}</p>{/if}
    </div>
  </section>{/if}

<style>
  .quota .panel-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .quota strong {
    font-size: 25px;
    color: #6678bf;
  }
  .quota span,
  .quota small,
  .quota-inline {
    font-size: 11px;
    color: #8491a8;
  }
  .quota progress {
    width: 100%;
    height: 7px;
    accent-color: #6678bf;
  }
</style>
