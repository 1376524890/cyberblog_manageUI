<script lang="ts">
  import { onMount, createEventDispatcher } from "svelte";
  import { api } from "../lib/api.ts";
  import { messageOf, today, type Collection } from "../lib/content.ts";
  export let collection: Collection = "posts",
    title = "",
    body = "";
  let items: { id: string; name: string; description: string; body: string }[] =
      [],
    selected = "",
    mode = "append",
    open = false,
    error = "";
  const dispatch = createEventDispatcher();
  $: chosen = items.find((t) => t.id === selected);
  $: text = (chosen?.body ?? "")
    .replaceAll("{{title}}", title || "待填写标题")
    .replaceAll("{{date}}", today());
  onMount(() => {
    void api
      .get<{ items: typeof items }>(`/templates?collection=${collection}`)
      .then((r) => (items = r.items))
      .catch((e) => (error = messageOf(e)));
  });
</script>

<div class="template-tools">
  <button type="button" class:active={open} on:click={() => (open = !open)}
    >▤ Markdown 模板</button
  >{#if open}<div class="template-panel">
      <div class="action-row">
        <select aria-label="内容模板" bind:value={selected}
          ><option value="">选择模板</option>{#each items as t}<option
              value={t.id}>{t.name}</option
            >{/each}</select
        ><select aria-label="模板插入方式" bind:value={mode}
          ><option value="append">追加到正文</option><option value="replace"
            >替换当前正文</option
          ></select
        ><button
          class="primary"
          disabled={!chosen}
          on:click={() =>
            dispatch("apply", {
              body:
                mode === "append" && body.trim() ? body + "\n\n" + text : text,
            })}>应用模板</button
        >
      </div>
      {#if chosen}<p class="hint">
          {chosen.description}{mode === "replace" && body.trim()
            ? "；应用后将替换当前正文，可使用编辑器撤销 AI/模板变更。"
            : ""}
        </p>
        <details>
          <summary>预览模板</summary>
          <pre>{text}</pre>
        </details>{/if}{#if error}<div class="err">{error}</div>{/if}
    </div>{/if}
</div>

<style>
  .template-tools {
    padding: 12px 16px;
    border-bottom: 1px solid #e8ecf3;
    background: #fcfcff;
  }
  .template-tools > button {
    font-size: 11px;
    padding: 7px 10px;
  }
  .template-tools > button.active {
    color: #5366df;
    background: #eef0ff;
  }
  .template-panel {
    padding-top: 14px;
  }
  .template-panel select {
    font-size: 11px;
  }
  .template-panel .primary {
    font-size: 11px;
    padding: 9px 12px;
  }
  .template-panel .hint {
    font-size: 11px;
    margin: 12px 0;
  }
  summary {
    font-size: 11px;
    color: #8b97b1;
    cursor: pointer;
  }
  pre {
    font: 11px/1.8 monospace;
    white-space: pre-wrap;
    max-height: 230px;
    overflow: auto;
    background: #f5f7fb;
    padding: 15px;
    border-radius: 8px;
    color: #78869e;
  }
</style>
