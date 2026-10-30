<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
  import { api } from "../lib/api.ts";
  import { messageOf, type Collection } from "../lib/content.ts";
  export let body = "",
    title = "",
    description = "",
    tags = "",
    collection: Collection = "posts";
  const dispatch = createEventDispatcher();
  let open = false,
    mode = "format",
    instruction = "",
    busy = false,
    error = "",
    result = "",
    base = "",
    baseState = "",
    resultMode = "",
    metadata: { title: string; description: string; tags: string[] } | null =
      null;
  const modes = [
    { value: "format", label: "整理排版" },
    { value: "rewrite", label: "润色表达" },
    { value: "continue", label: "续写正文" },
    { value: "outline", label: "生成提纲" },
    { value: "create", label: "创作正文" },
    { value: "metadata", label: "标题 / 摘要 / 标签" },
  ];
  let generation = 0;
  async function generate() {
    if (busy) return;
    busy = true;
    error = "";
    result = "";
    metadata = null;
    base = body;
    baseState = JSON.stringify({ body, title, description, tags });
    resultMode = mode;
    const id = ++generation;
    try {
      const r = await api.post<{ text?: string; metadata?: typeof metadata }>(
        "/ai/edit",
        { mode, instruction, body, title, collection },
      );
      if (id !== generation) return;
      result = r.text ?? "";
      metadata = r.metadata ?? null;
    } catch (e) {
      error = messageOf(e);
    } finally {
      if (id === generation) busy = false;
    }
  }
  function apply(append = false) {
    if (baseState !== JSON.stringify({ body, title, description, tags })) {
      error =
        "正文在生成期间发生变化，请先复制建议或重新生成，避免覆盖新内容。";
      return;
    }
    dispatch(
      "apply",
      metadata
        ? { metadata }
        : {
            body:
              append || resultMode === "continue"
                ? body + "\n\n" + result
                : result,
          },
    );
    result = "";
    metadata = null;
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        metadata ? JSON.stringify(metadata, null, 2) : result,
      );
      error = "已复制建议";
    } catch {
      error = "复制失败，可选中下方文本手动复制";
    }
  }
  onDestroy(() => generation++);
</script>

<div class="ai-editor">
  <button class="ai-toggle" on:click={() => (open = !open)}
    >✦ AI 编辑助手 <span>{open ? "收起" : "排版 · 创作 · 润色"}</span></button
  >{#if open}<div class="ai-editor-body">
      <div class="action-row">
        <select aria-label="AI 编辑任务" bind:value={mode} disabled={busy}
          >{#each modes as m}<option value={m.value}>{m.label}</option
            >{/each}</select
        ><a href="#/ai-settings">模型设置 ↗</a>
      </div>
      <label class="form-field"
        ><span>补充要求（可选）</span><textarea
          rows="2"
          bind:value={instruction}
          placeholder="例如：面向零基础读者，保留代码，增加清晰的小标题"
        ></textarea></label
      >
      <div class="ai-editor-actions">
        <small>当前正文与要求将发送至你配置的模型服务；建议先预览再应用。</small
        ><button class="primary" disabled={busy} on:click={generate}
          >{busy ? "正在生成…" : "生成建议 ✦"}</button
        >
      </div>
      {#if error}<div class="err" role="status">{error}</div>{/if}
      {#if result || metadata}<div class="ai-result">
          <div class="section-heading">
            <strong>建议预览</strong><span>当前文件尚未改动</span>
          </div>
          {#if metadata}<dl>
              <dt>标题</dt>
              <dd>{metadata.title}</dd>
              <dt>摘要</dt>
              <dd>{metadata.description}</dd>
              <dt>标签</dt>
              <dd>{metadata.tags.join(" / ")}</dd>
            </dl>{:else}<pre>{result}</pre>{/if}
          <div class="action-row">
            <button
              class="primary"
              disabled={baseState !==
                JSON.stringify({ body, title, description, tags })}
              on:click={() => apply()}
              >{metadata
                ? "应用基础设置"
                : resultMode === "continue"
                  ? "追加续写"
                  : "替换正文为建议"}</button
            >{#if !metadata && resultMode !== "continue"}<button
                disabled={baseState !==
                  JSON.stringify({ body, title, description, tags })}
                on:click={() => apply(true)}>追加到正文</button
              >{/if}<button on:click={copy}>复制</button><button
              on:click={() => {
                result = "";
                metadata = null;
              }}>舍弃建议</button
            >
          </div>
        </div>{/if}
    </div>{/if}
</div>

<style>
  .ai-editor {
    border-bottom: 1px solid #e3e7f6;
    background: linear-gradient(100deg, #f5f6ff, #fafbff);
  }
  .ai-toggle {
    width: 100%;
    justify-content: space-between;
    border: 0;
    background: transparent;
    border-radius: 0;
    padding: 15px 19px;
    color: #6c76b7;
    font-size: 12px;
  }
  .ai-toggle span {
    font-size: 10px;
    color: #a1a8c8;
  }
  .ai-editor-body {
    padding: 3px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .action-row select {
    font-size: 11px;
  }
  .action-row a {
    font-size: 11px;
    margin-left: auto;
  }
  .ai-editor-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
  }
  .ai-editor-actions small {
    font-size: 10px;
    line-height: 1.8;
    color: #9ba5be;
  }
  .ai-editor-actions button {
    white-space: nowrap;
    font-size: 11px;
  }
  .ai-result {
    border: 1px solid #e0e4f6;
    background: white;
    padding: 17px;
    border-radius: 9px;
  }
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: #8190b0;
  }
  .section-heading span {
    font-size: 10px;
    color: #a5aec3;
  }
  .ai-result pre {
    font: 12px/1.9 monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 380px;
    overflow: auto;
    color: #697994;
    margin: 16px 0;
  }
  .ai-result button {
    font-size: 10px;
    padding: 7px 9px;
  }
  .ai-result dl {
    font-size: 12px;
    color: #7a88a3;
    line-height: 1.8;
  }
  .ai-result dt {
    font-size: 10px;
    color: #a3adc3;
  }
  .ai-result dd {
    margin: 0 0 12px;
  }
  .ai-editor textarea {
    font-size: 12px;
  }
  .ai-editor .err {
    font-size: 11px;
  }
</style>
