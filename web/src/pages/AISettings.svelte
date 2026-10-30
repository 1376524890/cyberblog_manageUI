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
    dailyTokenLimit: number;
    monthlyTokenLimit: number;
    usageWarnPercent: number;
    enforceBudget: boolean;
  }
  interface Diagnostic {
    ok: boolean;
    model: string;
    testedAt: string;
    durationMs: number;
    checks: {
      name: string;
      status: string;
      detail: string;
      durationMs: number;
      code?: string;
      httpStatus?: number;
    }[];
    usage: {
      total_tokens: number | null;
      known_total_tokens: number;
      requests: number;
      unreported_requests: number;
    };
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
    dailyTokenLimit: 0,
    monthlyTokenLimit: 0,
    usageWarnPercent: 80,
    enforceBudget: false,
  };
  let key = "",
    clearKey = false,
    error = "",
    message = "",
    busy = false,
    loading = true,
    initial = "",
    models: string[] = [],
    modelSearch = "",
    modelLoading = false,
    modelError = "",
    modelInfo = "",
    autoModels = true,
    includeTools = false,
    testing = false,
    diagnostic: Diagnostic | null = null,
    testedForm = "";
  let keyVersion = 0,
    testedKeyVersion = 0;
  $: serialized = JSON.stringify(settings);
  $: diagnosticForm = JSON.stringify([
    settings.baseUrl,
    settings.model,
    settings.mode,
    settings.temperature,
    settings.tokenParameter,
    settings.maxTokens,
    settings.timeoutSeconds,
  ]);
  $: filteredModels = models.filter((m) =>
    m.toLowerCase().includes(modelSearch.toLowerCase()),
  );
  $: setUnsavedChanges(
    !loading && (serialized !== initial || !!key || clearKey),
  );
  function connection() {
    return {
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: key || undefined,
      mode: settings.mode,
      temperature: settings.temperature,
      tokenParameter: settings.tokenParameter,
      maxTokens: settings.maxTokens,
      timeoutSeconds: settings.timeoutSeconds,
    };
  }
  async function load() {
    try {
      settings = await api.get<Settings>("/ai/settings");
      initial = JSON.stringify(settings);
      const last = await api.get<{ result: Diagnostic | null }>(
        "/ai/diagnostics",
      );
      diagnostic = last.result;
      testedForm = diagnosticForm;
      if (autoModels && settings.hasKey) void listModels(false);
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
      message = "配置已保存到服务器 .env，立即生效。";
      if (settings.hasKey && autoModels) void listModels(false);
      if (!settings.hasKey) {
        models = [];
        diagnostic = null;
      }
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
      diagnostic = await api.post<Diagnostic>("/ai/diagnostics", {
        ...connection(),
        includeTools,
      });
      testedForm = diagnosticForm;
      testedKeyVersion = keyVersion;
      message = diagnostic.ok
        ? "实际生成成功，查看下方各阶段检查。"
        : "连接测试未通过，请查看各阶段失败原因。";
    } catch (e) {
      error = messageOf(e);
    } finally {
      testing = false;
    }
  }
  async function listModels(force = true) {
    if (modelLoading || clearKey) return;
    modelLoading = true;
    modelError = "";
    try {
      const r = await api.post<{
        items: string[];
        count: number;
        cached: boolean;
        fetchedAt: string;
        durationMs: number;
      }>("/ai/models", {
        baseUrl: settings.baseUrl,
        apiKey: key || undefined,
        force,
      });
      models = r.items;
      modelInfo = `${r.count} 个模型 · ${r.cached ? "缓存" : "实时获取"} · ${r.durationMs}ms · ${new Date(r.fetchedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
      if (!models.length)
        modelError = "接口返回空列表，可手动填写模型 ID 后测试生成。";
    } catch (e) {
      models = [];
      modelInfo = "";
      modelError = messageOf(e) + "；仍可手动填写模型 ID。";
    } finally {
      modelLoading = false;
    }
  }
  function discoverOnBlur() {
    if (autoModels && !clearKey && (key || settings.hasKey))
      void listModels(false);
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
  <div class="action-row">
    <a class="button" href="#/ai-usage">Token 用量 ↗</a><a
      class="button"
      href="#/ai">AI 工作台 ↗</a
    >
  </div>
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
            on:blur={discoverOnBlur}
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
            on:input={() => keyVersion++}
            on:blur={discoverOnBlur}
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
        <div class="model-discovery">
          <div class="discovery-head">
            <strong>可用模型 ID</strong><button
              type="button"
              disabled={modelLoading || clearKey || (!key && !settings.hasKey)}
              on:click={() => listModels(true)}
              >{modelLoading ? "正在获取…" : "获取 / 刷新模型"}</button
            >
          </div>
          <label class="check-field"
            ><input
              type="checkbox"
              bind:checked={autoModels}
            />打开设置、保存连接或离开密钥输入框时自动获取</label
          >{#if modelInfo}<p class="hint">
              {modelInfo}
            </p>{/if}{#if modelError}<div class="model-warning" role="status">
              {modelError}
            </div>{/if}{#if models.length}<input
              aria-label="搜索模型 ID"
              type="search"
              bind:value={modelSearch}
              placeholder="搜索模型 ID…"
            /><select
              class="model-options"
              size="5"
              aria-label="可用模型 ID 列表"
              bind:value={settings.model}
              >{#if settings.model && !filteredModels.includes(settings.model)}<option
                  value={settings.model}
                  >{settings.model}（{models.includes(settings.model)
                    ? "当前选择"
                    : "自定义 ID"}）</option
                >{/if}{#each filteredModels as m}<option value={m}>{m}</option
                >{/each}</select
            ><small
              >选择模型后保存配置。列表可能包含非对话模型，请再测试实际生成。</small
            >{/if}
        </div>
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
        <section class="quota-settings">
          <h3>Token 额度与告警</h3>
          <div class="form-grid">
            <label class="form-field"
              >每日 Token 额度<input
                type="number"
                min="0"
                max="1000000000"
                step="1"
                bind:value={settings.dailyTokenLimit}
              /><small>0 表示不限制</small></label
            ><label class="form-field"
              >每月 Token 额度<input
                type="number"
                min="0"
                max="10000000000"
                step="1"
                bind:value={settings.monthlyTokenLimit}
              /><small>0 表示不限制</small></label
            ><label class="form-field"
              >预警阈值（%）<input
                type="number"
                min="10"
                max="100"
                step="1"
                bind:value={settings.usageWarnPercent}
              /></label
            ><label class="check-field"
              ><input
                type="checkbox"
                bind:checked={settings.enforceBudget}
              />达到额度后阻止后续模型请求</label
            >
          </div>
          <p class="hint">
            按本 CMS
            已记录的总用量判断，含连接测试。进行中请求及接口未上报用量可能超出额度；不是服务商账户限额。
          </p>
        </section>
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
      <div class="diagnostic-controls">
        <label class="check-field"
          ><input
            type="checkbox"
            bind:checked={includeTools}
          />附加工具调用兼容测试</label
        >
        <p class="hint">
          测试当前表单连接（无需先启用 AI）；会请求实际模型并计入 token
          用量，测试设置不会自动保存。
        </p>
      </div>
      <div class="settings-actions">
        <button
          type="button"
          disabled={modelLoading ||
            testing ||
            clearKey ||
            (!key && !settings.hasKey)}
          on:click={() => listModels(true)}
          >{modelLoading ? "获取模型中…" : "读取模型列表"}</button
        ><button
          type="button"
          disabled={busy ||
            testing ||
            clearKey ||
            !settings.model ||
            (!key && !settings.hasKey)}
          on:click={test}>{testing ? "正在诊断…" : "运行连通性测试"}</button
        ><button type="submit" class="primary" disabled={busy || testing}
          >{busy ? "保存中…" : "保存配置"}</button
        >
      </div>
      {#if diagnostic}<section class="diagnostic-result">
          <div class="discovery-head">
            <h3>最近连接诊断</h3>
            <span class="badge" class:draft={!diagnostic.ok}
              >{diagnostic.ok ? "生成可用" : "生成未通过"}</span
            >
          </div>
          <p class="hint">
            {diagnostic.model} · {new Date(diagnostic.testedAt).toLocaleString(
              "zh-CN",
              { timeZone: "Asia/Shanghai" },
            )} · 总耗时 {diagnostic.durationMs}ms{testedForm !==
              diagnosticForm ||
            testedKeyVersion !== keyVersion ||
            clearKey
              ? " · 表单已变更，请重新测试"
              : ""}
          </p>
          {#each diagnostic.checks as check}<div class="diagnostic-check">
              <span
                class="check-mark"
                class:bad={check.status === "fail"}
                class:warn={check.status === "warning"}
                >{check.status === "pass"
                  ? "✓"
                  : check.status === "fail"
                    ? "×"
                    : check.status === "warning"
                      ? "!"
                      : "—"}</span
              >
              <div>
                <strong>{check.name}</strong>
                <p>{check.detail}</p>
                {#if check.code}<small>{check.code}</small>{/if}
              </div>
              <small>{check.durationMs}ms</small>
            </div>{/each}
          <p class="hint">
            本次测试：{diagnostic.usage.requests} 次模型调用 · {diagnostic.usage
              .total_tokens === null
              ? "已上报 " + diagnostic.usage.known_total_tokens
              : diagnostic.usage.total_tokens} Tokens{diagnostic.usage
              .unreported_requests
              ? " · " + diagnostic.usage.unreported_requests + " 次未上报用量"
              : ""}
          </p>
        </section>{/if}
    </form>
    <aside class="panel">
      <div class="panel-body guide">
        <h3>把 AI 接入工作流</h3>
        <ol>
          <li>填写接口地址、模型和密钥。</li>
          <li>获取模型 ID，测试连接后保存配置。</li>
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
  .model-discovery {
    background: #f8f9fe;
    border: 1px solid #e4e8f3;
    border-radius: 10px;
    padding: 17px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .discovery-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: #7888a7;
    font-size: 12px;
  }
  .discovery-head button {
    font-size: 10px;
    padding: 7px 10px;
  }
  .model-discovery .hint {
    margin: 0;
    font-size: 10px;
  }
  .model-options {
    width: 100%;
    font: 11px/1.9 monospace;
    padding: 7px;
  }
  .model-options option {
    padding: 7px 9px;
    border-radius: 4px;
  }
  .model-warning {
    font-size: 11px;
    line-height: 1.8;
    color: #b29463;
    background: #fff8e9;
    padding: 10px;
    border-radius: 7px;
  }
  .quota-settings {
    padding-top: 20px;
    border-top: 1px solid #e8ecf3;
  }
  .quota-settings h3,
  .diagnostic-result h3 {
    font-size: 13px;
    color: #7d8da9;
    margin: 0 0 16px;
  }
  .quota-settings .hint {
    font-size: 10px;
    margin: 13px 0 0;
  }
  .diagnostic-controls {
    padding: 0 24px 15px;
  }
  .diagnostic-controls .hint {
    font-size: 10px;
    margin: 10px 0 0;
  }
  .diagnostic-result {
    padding: 22px;
    border-top: 1px solid #e8ecf3;
    background: #fcfcff;
  }
  .diagnostic-result h3 {
    margin: 0;
  }
  .diagnostic-check {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 15px 0;
    border-bottom: 1px solid #eef1f7;
  }
  .diagnostic-check > div {
    flex: 1;
    min-width: 0;
  }
  .diagnostic-check strong {
    font-size: 12px;
    color: #7f8fab;
    font-weight: 500;
  }
  .diagnostic-check p {
    font-size: 11px;
    color: #a0abc0;
    line-height: 1.8;
    margin: 7px 0 0;
    overflow-wrap: anywhere;
  }
  .diagnostic-check small {
    font-size: 9px;
    color: #aeb7c9;
  }
  .check-mark {
    display: grid;
    place-items: center;
    width: 21px;
    height: 21px;
    background: #edf7f2;
    color: #7ba791;
    border-radius: 50%;
    font-size: 11px;
  }
  .check-mark.bad {
    background: #fff0f1;
    color: #bc8992;
  }
  .check-mark.warn {
    background: #fff5e2;
    color: #bda36c;
  }

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
