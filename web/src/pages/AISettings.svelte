<script lang="ts">
  import { onMount } from "svelte";
  import { api, setUnsavedChanges } from "../lib/api.ts";
  import { messageOf } from "../lib/content.ts";
  interface Settings {
    enabled: boolean;
    baseUrl: string;
    model: string;
    hasKey: boolean;
    mode: "tools" | "json";
    temperature: number | null;
    maxTokens: number;
    timeoutSeconds: number;
    systemPrompt: string;
    tokenParameter: "max_tokens" | "max_completion_tokens";
  }
  let settings: Settings = {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    model: "",
    hasKey: false,
    mode: "tools",
    temperature: 0.6,
    maxTokens: 4096,
    timeoutSeconds: 90,
    systemPrompt: "",
    tokenParameter: "max_tokens",
  };
  let key = "",
    clearKey = false,
    error = "",
    message = "",
    busy = false,
    loading = true,
    models: string[] = [],
    testing = false,
    initial = "";
  $: serialized = JSON.stringify(settings);
  $: setUnsavedChanges(
    !loading && (serialized !== initial || !!key || clearKey),
  );
  async function load() {
    try {
      settings = await api.get<Settings>("/ai/settings");
      initial = JSON.stringify(settings);
    } catch (e) {
      error = messageOf(e);
    } finally {
      loading = false;
    }
  }
  async function save() {
    busy = true;
    error = "";
    message = "";
    try {
      settings = await api.put<Settings>("/ai/settings", {
        ...settings,
        hasKey: undefined,
        apiKey: key || undefined,
        clearKey,
      });
      key = "";
      clearKey = false;
      initial = JSON.stringify(settings);
      setUnsavedChanges(false);
      message =
        "配置已安全保存到服务器 .env，立即生效。密钥不会回显或进入 Git。";
    } catch (e) {
      error = messageOf(e);
    } finally {
      busy = false;
    }
  }
  async function test() {
    testing = true;
    error = "";
    message = "";
    try {
      const r = await api.post<{ model: string; message: string }>(
        "/ai/test",
        {},
      );
      message = `连接成功 · ${r.model} · ${r.message}`;
    } catch (e) {
      error = messageOf(e);
    } finally {
      testing = false;
    }
  }
  async function listModels() {
    testing = true;
    error = "";
    try {
      models = (await api.post<{ items: string[] }>("/ai/models", {})).items;
      message = `读取到 ${models.length} 个模型，也可手动输入模型名称。`;
    } catch (e) {
      error = messageOf(e);
    } finally {
      testing = false;
    }
  }
  onMount(() => {
    void load();
    return () => {
      setUnsavedChanges(false);
      key = "";
    };
  });
</script>

<div class="page-heading">
  <div>
    <div class="eyebrow">AI / CONNECTION</div>
    <h1>AI 设置</h1>
    <p class="muted">接入你的模型服务，让创作与管理拥有同一个助手。</p>
  </div>
  <a class="button" href="#/ai">打开 AI 工作台 ↗</a>
</div>
{#if error}<div class="err" role="alert">{error}</div>{/if}{#if message}<div
    class="msg"
    role="status"
  >
    {message}
  </div>{/if}
{#if loading}<div class="empty">读取设置…</div>{:else}<div
    class="settings-layout"
  >
    <form class="panel" on:submit|preventDefault={save}>
      <div class="panel-head">
        <h2>OpenAI 兼容接口</h2>
        <span class="badge" class:draft={!settings.enabled}
          >{settings.enabled ? "已启用" : "未启用"}</span
        >
      </div>
      <div class="panel-body settings-fields">
        <label class="form-field"
          >接口基础地址<input
            type="url"
            bind:value={settings.baseUrl}
            required
            placeholder="https://api.example.com/v1"
          /><small
            >填写 API 地址，通常以 /v1 结尾。HTTPS 必须有效；本机模型可使用
            http://127.0.0.1。</small
          ></label
        ><label class="form-field"
          >API 密钥<input
            type="password"
            bind:value={key}
            autocomplete="new-password"
            placeholder={settings.hasKey
              ? "已保存密钥；留空保留原值"
              : "输入服务商密钥"}
          /></label
        ><label class="check-field"
          ><input
            type="checkbox"
            bind:checked={clearKey}
          />删除已保存密钥（须先关闭 AI）</label
        >
        <div class="form-grid">
          <label class="form-field"
            >模型名称<input
              list="model-list"
              bind:value={settings.model}
              placeholder="填写服务商提供的模型 ID"
              required={settings.enabled}
            /><datalist id="model-list"
              >{#each models as m}<option value={m}></option>{/each}</datalist
            ></label
          ><label class="form-field"
            >对话兼容模式<select bind:value={settings.mode}
              ><option value="tools">原生工具调用（推荐）</option><option
                value="json">JSON 指令（无工具调用模型）</option
              ></select
            ></label
          ><label class="form-field"
            >输出长度上限<input
              type="number"
              min="256"
              max="16384"
              step="256"
              bind:value={settings.maxTokens}
            /></label
          ><label class="form-field"
            >长度参数<select bind:value={settings.tokenParameter}
              ><option value="max_tokens">max_tokens（通用接口）</option><option
                value="max_completion_tokens">max_completion_tokens</option
              ></select
            ></label
          ><label class="form-field"
            >温度设置<select
              value={settings.temperature === null ? "auto" : "custom"}
              on:change={(e) =>
                (settings.temperature =
                  e.currentTarget.value === "auto" ? null : 0.6)}
              ><option value="custom">手动设置</option><option value="auto"
                >由模型决定（不发送参数）</option
              ></select
            >{#if settings.temperature !== null}<input
                aria-label="温度数值"
                type="number"
                min="0"
                max="2"
                step="0.1"
                bind:value={settings.temperature}
              />{/if}</label
          ><label class="form-field"
            >单次请求超时（秒）<input
              type="number"
              min="10"
              max="180"
              bind:value={settings.timeoutSeconds}
            /></label
          >
        </div>
        <label class="form-field"
          >写作偏好（可选）<textarea
            rows="4"
            bind:value={settings.systemPrompt}
            placeholder="例如：中文表达自然，面向大学社团读者，保留代码和技术名词"
          ></textarea></label
        ><label class="check-field consent"
          ><input type="checkbox" bind:checked={settings.enabled} /><span
            >启用
            AI，允许将我提交的指令、正文及完成任务所需的博客内容发送到上述接口。</span
          ></label
        >
      </div>
      <div class="settings-actions">
        <button
          type="button"
          disabled={busy ||
            testing ||
            !settings.hasKey ||
            serialized !== initial ||
            !!key ||
            clearKey}
          on:click={listModels}>读取模型列表</button
        ><button
          type="button"
          disabled={busy ||
            testing ||
            !settings.enabled ||
            serialized !== initial ||
            !!key ||
            clearKey}
          on:click={test}>{testing ? "正在连接…" : "测试已保存配置"}</button
        ><button type="submit" class="primary" disabled={busy || testing}
          >{busy ? "保存中…" : "保存配置"}</button
        >
      </div>
    </form>
    <aside class="panel">
      <div class="panel-body guide">
        <h3>把 AI 接入工作流</h3>
        <ol>
          <li>填写接口地址、模型和密钥。</li>
          <li>保存配置，再测试连接。</li>
          <li>在编辑器使用排版、创作和摘要功能。</li>
          <li>在 AI 工作台用对话准备管理操作。</li>
        </ol>
        <h3>密钥如何保存</h3>
        <p>
          仅后端读取服务器 .env，文件权限为
          600。页面只显示是否已保存，不会读取密钥原文。密钥不会进入浏览器存储、模型对话或
          Git。
        </p>
        <h3>兼容性提示</h3>
        <p>
          接口地址、模型列表、工具调用支持情况由服务商决定。模型不支持工具调用时选
          JSON 指令；不支持温度参数时选「由模型决定」。
        </p>
        <h3>操作边界</h3>
        <p>
          AI
          查询可以自动完成。保存、删除和推送会先生成可核对的操作卡片，确认后才执行；AI
          不接触服务器命令、账号或密钥设置。
        </p>
      </div>
    </aside>
  </div>{/if}

<style>
  .settings-layout {
    display: grid;
    grid-template-columns: minmax(0, 760px) minmax(240px, 1fr);
    gap: 25px;
    align-items: start;
  }
  .settings-fields {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .settings-fields small {
    font-size: 10px;
    color: #9aa8c0;
    line-height: 1.8;
  }
  .settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    flex-wrap: wrap;
    padding: 20px;
    border-top: 1px solid #e8ecf3;
  }
  .settings-actions button {
    font-size: 11px;
  }
  .consent {
    align-items: flex-start;
    background: #f3f5ff;
    padding: 15px;
    border-radius: 8px;
    line-height: 1.8;
  }
  .consent input {
    margin-top: 4px;
  }
  .guide h3 {
    color: #6e7d9b;
    margin: 24px 0 14px;
  }
  .guide h3:first-child {
    margin-top: 0;
  }
  .guide p,
  .guide li {
    font-size: 12px;
    line-height: 1.9;
    color: #929fba;
  }
  .guide ol {
    padding-left: 18px;
  }
  @media (max-width: 1100px) {
    .settings-layout {
      grid-template-columns: 1fr;
    }
    .guide {
      display: none;
    }
  }
</style>
