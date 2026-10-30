<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { api, contentSaved } from "../lib/api.ts";
  import { messageOf } from "../lib/content.ts";
  import { conversation, chatRequest, type Proposal } from "../lib/ai.ts";
  import TokenUsage from "../components/TokenUsage.svelte";
  import ActionCard from "../components/ActionCard.svelte";
  import Icon from "../components/Icon.svelte";
  let input = "",
    busy = false,
    progress = "",
    error = "",
    enabled = false,
    model = "",
    settingsLoaded = false,
    controller: AbortController | null = null,
    executing = false,
    end: HTMLDivElement;
  let records: {
    id: string;
    time: string;
    operation: string;
    collection?: string;
    slug?: string;
    ok: boolean;
  }[] = [];
  $: pending = $conversation
    .flatMap((t) => t.proposals ?? [])
    .filter((p) => p.state === "pending");
  const examples = [
    "查看当前内容和待发布状态，给我下一步建议",
    "我要添加一位新成员，请先问我需要哪些资料",
    "规划 Python 教程下一篇，并准备一个草稿",
    "帮我检查成员简介和社交链接是否完整",
  ];
  function update(p: Proposal, patch: Partial<Proposal>) {
    conversation.update((turns) =>
      turns.map((t) => ({
        ...t,
        proposals: t.proposals?.map((item) =>
          item.id === p.id ? { ...item, ...patch } : item,
        ),
      })),
    );
  }
  async function audit() {
    try {
      records = (await api.get<{ items: typeof records }>("/ai/history")).items;
    } catch {
      /* history is optional */
    }
  }
  async function apply(p: Proposal) {
    if (executing || p.state !== "pending") return;
    executing = true;
    update(p, { state: "running" });
    try {
      await api.post(`/ai/actions/${encodeURIComponent(p.id)}/apply`, {});
      update(p, { state: "done" });
      conversation.update((t) => [
        ...t,
        {
          role: "assistant",
          text: `操作 ${p.number} 已执行：${p.operation} ${p.collection ?? ""}/${p.slug ?? ""}。${p.operation === "publish" ? "推送已完成，等待博客构建。" : "修改已保存到仓库，尚需推送才对博客生效。"}`,
        },
      ]);
      contentSaved();
      await audit();
    } catch (e) {
      update(p, { state: "failed", error: messageOf(e) });
    } finally {
      executing = false;
    }
  }
  async function send() {
    const text = input.trim();
    if (!text || busy || executing) return;
    input = "";
    error = "";
    conversation.update((t) => [...t, { role: "user", text }]);
    const confirmation = text.match(/^确认执行(?:\s*(全部|\d+))?$/);
    if (confirmation) {
      const target = confirmation[1];
      const selected =
        target === "全部"
          ? pending
          : target
            ? pending.filter((p) => p.number === Number(target))
            : pending.length === 1
              ? pending
              : [];
      if (!selected.length) {
        conversation.update((t) => [
          ...t,
          {
            role: "assistant",
            text: "请核对待确认操作卡片，并输入「确认执行 编号」。例如：确认执行 1。",
          },
        ]);
        return;
      }
      for (const p of selected) await apply(p);
      return;
    }
    if (!enabled) {
      error = "请先在 AI 设置中配置并启用模型。";
      return;
    }
    busy = true;
    progress = "正在连接模型…";
    controller = new AbortController();
    try {
      const result = await chatRequest(
        $conversation
          .slice(-16)
          .map((t) => ({ role: t.role, content: t.text.slice(0, 6000) })),
        (value) => (progress = value),
        controller.signal,
      );
      const next = Math.max(
        0,
        ...$conversation
          .flatMap((t) => t.proposals ?? [])
          .map((p) => p.number ?? 0),
      );
      conversation.update((t) => [
        ...t,
        {
          role: "assistant",
          text: result.reply,
          proposals: result.proposals.map((p, i) => ({
            ...p,
            number: next + i + 1,
          })),
          trace: result.trace,
          usage: result.usage,
        },
      ]);
      await tick();
      end?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (e) {
      error =
        e instanceof DOMException && e.name === "AbortError"
          ? "已停止本次生成。"
          : messageOf(e);
    } finally {
      busy = false;
      progress = "";
      controller = null;
    }
  }
  function useExample(value: string) {
    input = value;
  }
  function clear() {
    if (busy || executing) return;
    conversation.set([]);
    error = "";
  }
  onMount(() => {
    void api
      .get<{ enabled: boolean; hasKey: boolean; model: string }>("/ai/settings")
      .then((s) => {
        enabled = s.enabled && s.hasKey;
        model = s.model;
      })
      .catch((e) => (error = messageOf(e)))
      .finally(() => (settingsLoaded = true));
    void audit();
  });
  onDestroy(() => controller?.abort());
</script>

<div class="page-heading">
  <div>
    <div class="eyebrow">AI / CONTENT COPILOT</div>
    <h1>用对话，管理你的内容。</h1>
    <p class="muted">从一个想法到一次发布，助手陪你把每一步准备好。</p>
  </div>
  <a class="button" href="#/ai-settings"
    ><Icon name="settings" size={16} />模型与连接</a
  >
</div>
<div class="ai-workspace">
  <section class="chat-panel panel">
    <div class="panel-head">
      <h2><span class="ai-spark">✦</span> Cyber 内容助手</h2>
      <div class="action-row">
        <span class="badge" class:draft={!enabled}
          >{settingsLoaded ? (enabled ? model : "等待配置") : "连接中"}</span
        ><button
          class="clear-chat"
          disabled={busy || executing}
          on:click={clear}>清空会话</button
        >
      </div>
    </div>
    <div class="conversation" aria-live="polite">
      {#if !$conversation.length}<div class="chat-welcome">
          <div class="welcome-spark">✦</div>
          <h2>把你想做的事，告诉我。</h2>
          <p>查找文章、创建成员、整理排版，或准备下一次更新。</p>
          <div class="prompt-grid">
            {#each examples as example}<button
                on:click={() => useExample(example)}
                >{example}<span>↗</span></button
              >{/each}
          </div>
          {#if settingsLoaded && !enabled}<a
              class="configure-link"
              href="#/ai-settings">首次使用，先连接你的模型服务 →</a
            >{/if}
        </div>{/if}
      {#each $conversation as turn}<div
          class="turn"
          class:user={turn.role === "user"}
        >
          <span class="speaker">{turn.role === "user" ? "你" : "✦"}</span>
          <div class="turn-body">
            <div class="turn-text">{turn.text}</div>
            <TokenUsage
              usage={turn.usage ?? null}
            />{#if turn.trace?.length}<details class="tool-trace">
                <summary>已完成 {turn.trace.length} 个查询 / 准备步骤</summary
                >{#each turn.trace as step}<div>✓ {step}</div>{/each}
              </details>{/if}{#each turn.proposals ?? [] as p}<ActionCard
                proposal={p}
                on:apply={() => apply(p)}
              />{/each}
          </div>
        </div>{/each}
      {#if busy}<div class="thinking">
          <span class="thinking-dot"></span>{progress}
        </div>{/if}
      <div bind:this={end}></div>
    </div>
    <div class="chat-composer">
      {#if error}<div class="err" role="alert">{error}</div>{/if}
      <form on:submit|preventDefault={send}>
        <label class="sr-only" for="ai-command">告诉助手你想做什么</label
        ><textarea
          id="ai-command"
          bind:value={input}
          rows="3"
          placeholder="例如：为一位擅长 Python 的新成员准备主页，先向我询问缺少的信息…"
          on:keydown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        ></textarea>
        <div class="composer-footer">
          <span>查询自动完成 · 写入先预览 · ⌘ / Ctrl + Enter 发送</span
          >{#if busy}<button type="button" on:click={() => controller?.abort()}
              >停止生成</button
            >{:else}<button
              class="primary"
              type="submit"
              disabled={!input.trim() || executing}
              >{executing ? "执行中…" : "发送指令"} ↑</button
            >{/if}
        </div>
      </form>
    </div>
  </section>
  <aside class="ai-side">
    <section class="panel">
      <div class="panel-head"><h2>助手可以做什么</h2></div>
      <div class="capabilities">
        <div>
          <Icon name="search" size={18} /><span
            ><strong>查找与理解</strong><small
              >按名称、板块、草稿状态查询内容</small
            ></span
          >
        </div>
        <div>
          <Icon name="users" size={18} /><span
            ><strong>维护成员资料</strong><small
              >准备身份、技能、社交链接和简介</small
            ></span
          >
        </div>
        <div>
          <Icon name="article" size={18} /><span
            ><strong>辅助创作</strong><small>参考模板，生成草稿与修改建议</small
            ></span
          >
        </div>
        <div>
          <Icon name="publish" size={18} /><span
            ><strong>准备发布</strong><small>核对待推送记录，再确认执行</small
            ></span
          >
        </div>
      </div>
    </section>
    <section class="pending-note">
      <strong>{pending.length} 个操作等待确认</strong>
      <p>
        核对卡片中的字段与正文。可以点击确认，也可以发送「确认执行
        1」或「确认执行全部」。
      </p>
      <small>操作预览 15 分钟后过期，内容变化时会阻止覆盖。</small>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>最近的执行记录</h2></div>
      <div class="audit-list">
        {#if !records.length}<p class="hint">
            确认操作后，这里会显示执行结果。
          </p>{/if}{#each records.slice(0, 6) as record}<div>
            <span class:failed={!record.ok}
              >{record.ok ? "✓" : "!"} {record.operation}</span
            ><strong>{record.slug || "博客发布"}</strong><small
              >{new Date(record.time).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}</small
            >
          </div>{/each}
      </div>
    </section>
  </aside>
</div>

<style>
  .ai-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 270px;
    gap: 23px;
    align-items: start;
  }
  .chat-panel {
    display: flex;
    flex-direction: column;
    min-height: 650px;
  }
  .chat-panel .panel-head h2 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ai-spark {
    color: #8a80c9;
  }
  .clear-chat {
    padding: 5px 7px;
    border: 0;
    font-size: 10px;
    color: #9ca9c0;
  }
  .conversation {
    padding: 24px;
    flex: 1;
    max-height: 70vh;
    min-height: 380px;
    overflow: auto;
  }
  .chat-welcome {
    text-align: center;
    padding: 29px 5px;
  }
  .welcome-spark {
    font-size: 33px;
    display: grid;
    place-items: center;
    width: 65px;
    height: 65px;
    border-radius: 20px;
    background: #f0edff;
    color: #9589ce;
    margin: 0 auto 25px;
  }
  .chat-welcome h2 {
    font-size: 21px;
    color: #63728f;
  }
  .chat-welcome p {
    font-size: 12px;
    color: #9aa7bf;
    line-height: 1.9;
  }
  .prompt-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 28px;
  }
  .prompt-grid button {
    text-align: left;
    justify-content: space-between;
    padding: 15px;
    font-size: 11px;
    line-height: 1.8;
    gap: 12px;
    color: #8d9bb7;
    background: #fcfcff;
  }
  .prompt-grid span {
    color: #b1bbcf;
  }
  .configure-link {
    display: inline-block;
    margin-top: 25px;
    font-size: 11px;
  }
  .turn {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 24px;
  }
  .speaker {
    font-size: 13px;
    background: #f0edfc;
    color: #998ccc;
    border-radius: 9px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }
  .turn.user .speaker {
    background: #eaf0f9;
    color: #8a9fbe;
  }
  .turn-body {
    min-width: 0;
    flex: 1;
  }
  .turn-text {
    font-size: 13px;
    line-height: 1.9;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: #6b7d9b;
    padding-top: 3px;
  }
  .turn.user .turn-text {
    background: #f5f7fc;
    border-radius: 9px;
    padding: 12px 15px;
    color: #7f8da8;
  }
  .tool-trace {
    margin-top: 10px;
    color: #a6b0c5;
    font-size: 10px;
    line-height: 1.8;
  }
  .tool-trace summary {
    cursor: pointer;
  }
  .thinking {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #9c9cba;
    margin-left: 40px;
  }
  .thinking-dot {
    width: 6px;
    height: 6px;
    background: #a69bda;
    border-radius: 50%;
    animation: pulse 1s infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .chat-composer {
    padding: 17px 20px;
    border-top: 1px solid #e8ecf3;
    background: #fcfcff;
  }
  .chat-composer form {
    border: 1px solid #e0e5f2;
    border-radius: 11px;
    background: white;
    overflow: hidden;
  }
  .chat-composer textarea {
    width: 100%;
    display: block;
    border: 0;
    resize: vertical;
    font-size: 12px;
    line-height: 1.8;
    padding: 16px;
    min-height: 95px;
  }
  .chat-composer textarea:focus {
    outline: 0;
  }
  .composer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 13px;
    gap: 10px;
  }
  .composer-footer span {
    font-size: 9px;
    color: #aab4c8;
  }
  .composer-footer button {
    font-size: 11px;
    padding: 8px 13px;
    white-space: nowrap;
  }
  .ai-side {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .capabilities {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .capabilities > div {
    display: flex;
    gap: 12px;
    color: #a3add0;
  }
  .capabilities strong {
    font-size: 11px;
    color: #7e8dab;
    font-weight: 500;
  }
  .capabilities small {
    display: block;
    font-size: 10px;
    color: #a6b1c8;
    line-height: 1.9;
    margin-top: 6px;
  }
  .pending-note {
    padding: 23px;
    background: #f1f3ff;
    border: 1px solid #e2e6fc;
    border-radius: 11px;
  }
  .pending-note strong {
    font-size: 12px;
    color: #7a84b5;
  }
  .pending-note p {
    font-size: 11px;
    line-height: 1.9;
    color: #959fc0;
    margin: 13px 0;
  }
  .pending-note small {
    font-size: 10px;
    color: #a8b1cb;
    line-height: 1.8;
  }
  .audit-list {
    padding: 7px 20px;
  }
  .audit-list > div {
    padding: 14px 0;
    border-bottom: 1px solid #eff2f7;
  }
  .audit-list > div:last-child {
    border: 0;
  }
  .audit-list span {
    font-size: 10px;
    color: #7ea494;
  }
  .audit-list span.failed {
    color: #b68a8f;
  }
  .audit-list strong {
    font-size: 11px;
    display: block;
    margin: 7px 0;
    color: #8b99b4;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .audit-list small {
    font-size: 9px;
    color: #adb7ca;
  }
  .audit-list p {
    font-size: 11px;
    padding: 12px 0;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  @media (max-width: 1150px) {
    .ai-workspace {
      grid-template-columns: 1fr;
    }
    .ai-side {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .conversation {
      padding: 17px;
      max-height: 65vh;
    }
    .prompt-grid {
      grid-template-columns: 1fr;
    }
    .chat-welcome {
      padding: 15px 0;
    }
    .chat-panel .panel-head {
      gap: 8px;
    }
    .chat-panel .badge {
      max-width: 110px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .chat-composer {
      padding: 13px;
    }
    .composer-footer span {
      font-size: 8px;
    }
    .turn {
      gap: 8px;
    }
    .turn-text {
      font-size: 12px;
    }
  }
</style>
