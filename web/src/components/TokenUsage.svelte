<script lang="ts">
  import { isAdmin } from "../lib/api.ts";
  export let usage: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    known_total_tokens?: number;
    requests?: number;
    unreported_requests?: number;
  } | null = null;
  const n = (v: number | null | undefined) =>
    v == null ? "未上报" : v.toLocaleString("zh-CN");
</script>

{#if usage}<div class="token-usage">
    <span>本次{usage.requests ?? 1}次调用</span><span
      >输入 {n(usage.prompt_tokens)}</span
    ><span>输出 {n(usage.completion_tokens)}</span><span
      >{usage.total_tokens == null
        ? usage.known_total_tokens == null
          ? "总用量未上报"
          : "已知 " + n(usage.known_total_tokens)
        : "合计 " + n(usage.total_tokens)} Tokens</span
    >{#if usage.unreported_requests}<span
        >{usage.unreported_requests} 次用量未上报</span
      >{/if}{#if isAdmin()}<a href="#/ai-usage">用量明细 ↗</a>{/if}
  </div>{/if}

<style>
  .token-usage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    font-size: 9px;
    line-height: 1.8;
    color: #a3acc3;
    border-top: 1px dashed #e7eaf3;
    margin-top: 13px;
    padding-top: 10px;
  }
  .token-usage a {
    font-size: 9px;
    color: #929fc0;
  }
</style>
