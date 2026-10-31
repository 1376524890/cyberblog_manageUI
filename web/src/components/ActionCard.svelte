<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Proposal } from "../lib/ai.ts";
  export let proposal: Proposal;
  const dispatch = createEventDispatcher();
  const labels: Record<string, string> = {
    create: "创建内容",
    update: "更新内容",
    delete: "删除内容",
    publish: "推送发布",
    submit: "提交审核",
  };
  const collections: Record<string, string> = {
    posts: "文章",
    dynamic: "动态",
    projects: "成员",
    spec: "独立页面",
  };
  const display = (v: unknown) =>
    v === undefined
      ? "—"
      : v === null
        ? "清除字段"
        : typeof v === "object"
          ? JSON.stringify(v, null, 2)
          : String(v);
  $: fields = Object.keys(proposal.data ?? {});
  $: expired = Date.parse(proposal.expiresAt) < Date.now();
</script>

<section class="action-card" class:done={proposal.state === "done"}>
  <div class="card-heading">
    <span class="action-number">{proposal.number}</span>
    <div>
      <strong
        >{proposal.scope === "draft" && proposal.operation === "create"
          ? "创建私有草稿"
          : proposal.scope === "draft" && proposal.operation === "update"
            ? "更新私有草稿"
            : (labels[proposal.operation] ?? proposal.operation)}</strong
      ><small
        >{proposal.collection
          ? collections[proposal.collection] + " / " + proposal.slug
          : "博客内容仓库"}</small
      >
    </div>
    <span class="badge" class:draft={proposal.state === "pending"}
      >{proposal.state === "done"
        ? "已执行"
        : proposal.state === "running"
          ? "执行中"
          : proposal.state === "failed"
            ? "未执行成功"
            : expired
              ? "已过期"
              : "待确认"}</span
    >
  </div>
  <p class="reason">{proposal.reason || "按本次对话要求准备的操作"}</p>
  {#if proposal.operation === "delete"}<p class="delete-note">
      将删除该内容文件并创建提交；可从 Git 历史恢复。推送后影响博客前台。
    </p>{/if}
  {#if proposal.operation === "publish"}<p class="delete-note">
      将推送已提交内容并触发博客构建。请核对发布中心中的待推送记录。
    </p>{/if}
  {#if fields.length}<details>
      <summary>查看基础设置 · {fields.length} 项</summary>
      <div class="diff-table">
        <table>
          <thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead
          ><tbody
            >{#each fields as field}<tr
                ><td>{field}</td><td
                  ><pre>{display(proposal.before?.data[field])}</pre></td
                ><td><pre>{display(proposal.data?.[field])}</pre></td></tr
              >{/each}</tbody
          >
        </table>
      </div>
    </details>{/if}
  {#if proposal.body !== undefined}<details>
      <summary>{proposal.before ? "对比正文变化" : "预览新正文"}</summary>
      <div class="body-compare">
        {#if proposal.before}<div>
            <small>修改前</small>
            <pre>{proposal.before.body}</pre>
          </div>{/if}
        <div>
          <small>{proposal.before ? "修改后" : "拟创建正文"}</small>
          <pre>{proposal.body}</pre>
        </div>
      </div>
    </details>{/if}
  {#if proposal.error}<div class="err" role="alert">{proposal.error}</div>{/if}
  <div class="card-actions">
    {#if proposal.state === "pending"}<button
        class="primary"
        disabled={expired}
        on:click={() => dispatch("apply")}
        >{proposal.operation === "publish"
          ? "确认推送"
          : proposal.operation === "delete"
            ? "确认删除"
            : "确认执行"}</button
      ><small>也可输入「确认执行 {proposal.number}」</small
      >{:else if proposal.state === "done"}<span class="receipt"
        >✓ {proposal.scope === "draft"
          ? proposal.operation === "submit"
            ? "已提交待发布，等待管理员审核。"
            : "已保存为私有草稿。"
          : "已由管理接口完成，保存操作尚需推送才对博客生效。"}</span
      >{/if}{#if proposal.collection && proposal.slug && proposal.operation !== "delete" && (proposal.operation !== "create" || proposal.state === "done")}<a
        href={proposal.scope === "draft"
          ? `#/drafts/${proposal.draftId}`
          : `#/${proposal.collection}/${encodeURIComponent(proposal.slug)}`}
        >在表单中查看 ↗</a
      >{/if}
  </div>
</section>

<style>
  .action-card {
    margin: 16px 0 0;
    background: white;
    border: 1px solid #dfe4f4;
    border-radius: 11px;
    padding: 19px;
  }
  .action-card.done {
    border-color: #d4e9df;
  }
  .card-heading {
    display: flex;
    gap: 11px;
    align-items: center;
  }
  .action-number {
    display: grid;
    place-items: center;
    font-size: 11px;
    color: #7182bd;
    background: #eef1fc;
    width: 30px;
    height: 30px;
    border-radius: 8px;
  }
  .card-heading > div {
    flex: 1;
    min-width: 0;
  }
  .card-heading strong {
    font-size: 12px;
    color: #61718e;
  }
  .card-heading small {
    display: block;
    font-size: 10px;
    color: #a4aec3;
    margin-top: 5px;
    overflow-wrap: anywhere;
  }
  .reason {
    font-size: 12px;
    color: #8a98b2;
    line-height: 1.8;
    margin: 15px 0;
  }
  .delete-note {
    font-size: 11px;
    line-height: 1.8;
    color: #b28b70;
    background: #fff8ec;
    padding: 10px;
    border-radius: 7px;
  }
  details {
    margin: 12px 0;
  }
  summary {
    font-size: 11px;
    color: #8b98b4;
    cursor: pointer;
  }
  .diff-table {
    overflow: auto;
    margin-top: 12px;
  }
  .diff-table th,
  .diff-table td {
    padding: 10px;
    font-size: 10px;
    vertical-align: top;
  }
  .diff-table pre {
    font: 10px/1.7 monospace;
    white-space: pre-wrap;
    max-height: 160px;
    overflow: auto;
    max-width: 260px;
    overflow-wrap: anywhere;
    margin: 0;
  }
  .body-compare {
    display: flex;
    gap: 12px;
    margin-top: 14px;
  }
  .body-compare > div {
    flex: 1;
    min-width: 0;
    background: #f8f9fd;
    padding: 12px;
    border-radius: 7px;
  }
  .body-compare small {
    font-size: 10px;
    color: #a2aec2;
  }
  .body-compare pre {
    font: 11px/1.8 monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 330px;
    overflow: auto;
    color: #7b8ba7;
  }
  .card-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }
  .card-actions button {
    font-size: 11px;
    padding: 8px 12px;
  }
  .card-actions small,
  .card-actions a {
    font-size: 10px;
    color: #a2aec4;
  }
  .card-actions a {
    margin-left: auto;
    color: #7e8db6;
  }
  .receipt {
    font-size: 10px;
    color: #6f9c8a;
    line-height: 1.8;
  }
  @media (max-width: 650px) {
    .body-compare {
      flex-direction: column;
    }
    .action-card {
      padding: 14px;
    }
    .card-actions small {
      width: 100%;
    }
  }
</style>
