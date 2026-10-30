<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api.ts";
  import { messageOf } from "../lib/content.ts";
  interface Totals {
    requests: number;
    successful: number;
    failed: number;
    input: number;
    output: number;
    total: number;
    cached: number;
    reasoning: number;
    reportedRequests: number;
    unreportedRequests: number;
    missingInput: number;
    missingOutput: number;
    averageMs: number;
  }
  interface Budget {
    used: number;
    limit: number;
    percent: number | null;
    state: string;
    unreported: number;
  }
  interface Report {
    days: number;
    timezone: string;
    generatedAt: string;
    totals: Totals;
    today: Totals;
    month: Totals;
    budgets: {
      daily: Budget;
      monthly: Budget;
      enforce: boolean;
      warnPercent: number;
    };
    daily: (Totals & { date: string })[];
    models: (Totals & { model: string })[];
    modelOptions: string[];
    recent: {
      id: string;
      time: string;
      model: string;
      provider: string;
      kind: string;
      ok: boolean;
      durationMs: number;
      input: number | null;
      output: number | null;
      total: number | null;
      cached: number | null;
      reasoning: number | null;
      errorCode: string | null;
    }[];
    skippedRecords: number;
  }
  let report: Report | null = null,
    days = "7",
    model = "",
    error = "",
    loading = false,
    request = 0,
    auto = true;
  const known = (value: number, missing: number, requests: number) =>
    !requests || missing === requests
      ? "未上报"
      : missing
        ? "≥ " + value.toLocaleString("zh-CN")
        : value.toLocaleString("zh-CN");
  const n = (value: number | null | undefined) =>
    value == null ? "—" : value.toLocaleString("zh-CN");
  $: maximum = Math.max(1, ...(report?.daily.map((d) => d.total) ?? []));
  async function load() {
    const id = ++request;
    loading = true;
    error = "";
    try {
      const r = await api.get<Report>(
        `/ai/usage?days=${days}${model ? `&model=${encodeURIComponent(model)}` : ""}`,
      );
      if (id === request) report = r;
    } catch (e) {
      if (id === request) error = messageOf(e);
    } finally {
      if (id === request) loading = false;
    }
  }
  function download() {
    if (!report) return;
    const rows = [
      [
        "时间",
        "模型",
        "服务",
        "用途",
        "状态",
        "输入 tokens",
        "输出 tokens",
        "总 tokens",
        "缓存 tokens",
        "推理 tokens",
        "耗时毫秒",
        "错误代码",
      ],
      ...report.recent.map((r) => [
        r.time,
        r.model,
        r.provider,
        r.kind,
        r.ok ? "成功" : "失败",
        r.input ?? "",
        r.output ?? "",
        r.total ?? "",
        r.cached ?? "",
        r.reasoning ?? "",
        r.durationMs,
        r.errorCode ?? "",
      ]),
    ];
    const csv =
      "\ufeff" +
      rows
        .map((row) =>
          row
            .map(
              (v) =>
                '"' +
                (/^[=+@\-\t\r]/.test(String(v))
                  ? "'" + String(v)
                  : String(v)
                ).replaceAll('"', '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai-usage-recent.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (auto && !document.hidden && !loading) void load();
    }, 15000);
    return () => {
      clearInterval(timer);
      request++;
    };
  });
</script>

<div class="page-heading">
  <div>
    <div class="eyebrow">AI / USAGE & HEALTH</div>
    <h1>Token 用量监控</h1>
    <p class="muted">
      查看本管理界面发起的模型请求与已上报用量，按北京时间统计。
    </p>
  </div>
  <a class="button" href="#/ai-settings">配置额度与模型 ↗</a>
</div>
<div class="usage-toolbar">
  <div class="action-row">
    <select aria-label="统计时间范围" bind:value={days} on:change={load}
      ><option value="7">最近 7 天</option><option value="30">最近 30 天</option
      ><option value="90">最近 90 天</option></select
    ><select aria-label="用量模型筛选" bind:value={model} on:change={load}
      ><option value="">全部模型</option
      >{#each report?.modelOptions ?? [] as m}<option value={m}>{m}</option
        >{/each}</select
    ><label class="check-field"
      ><input type="checkbox" bind:checked={auto} />每 15 秒刷新</label
    >
  </div>
  <div class="action-row">
    <button disabled={loading} on:click={load}
      >{loading ? "刷新中…" : "刷新数据"}</button
    ><button disabled={!report?.recent.length} on:click={download}
      >导出最近记录</button
    >
  </div>
</div>
{#if error}<div class="err" role="alert">{error}</div>{/if}
{#if report}
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-top">今日已记录 Tokens</div>
      <strong>{n(report.today.total)}</strong><small
        >{report.today.requests} 次请求 · {report.today.unreportedRequests} 次未上报</small
      >
    </div>
    <div class="stat-card">
      <div class="stat-top">本月已记录 Tokens</div>
      <strong>{n(report.month.total)}</strong><small
        >输入 {known(
          report.month.input,
          report.month.missingInput,
          report.month.requests,
        )} / 输出 {known(
          report.month.output,
          report.month.missingOutput,
          report.month.requests,
        )}（已上报）</small
      >
    </div>
    <div class="stat-card">
      <div class="stat-top">当前范围请求成功率</div>
      <strong
        >{report.totals.requests
          ? Math.round(
              (report.totals.successful / report.totals.requests) * 100,
            ) + "%"
          : "—"}</strong
      ><small
        >{report.totals.successful} 成功 / {report.totals.failed} 失败</small
      >
    </div>
    <div class="stat-card">
      <div class="stat-top">平均模型响应耗时</div>
      <strong
        >{report.totals.requests
          ? (report.totals.averageMs / 1000).toFixed(2) + "s"
          : "—"}</strong
      ><small>{report.totals.requests} 次模型调用，含工具循环和连接测试</small>
    </div>
  </div>
  <div class="budget-grid">
    {#each [{ name: "每日额度", value: report.budgets.daily }, { name: "每月额度", value: report.budgets.monthly }] as b}<section
        class="panel budget"
        class:alert={b.value.state !== "normal"}
      >
        <div>
          <strong>{b.name}</strong><span
            >{n(b.value.used)} / {b.value.limit
              ? n(b.value.limit)
              : "不限制"}</span
          >
        </div>
        <progress
          max="100"
          value={Math.min(100, b.value.percent ?? 0)}
          aria-label={b.name}
        ></progress>
        <p>
          {b.value.state === "exceeded"
            ? "已达到额度"
            : b.value.state === "warning"
              ? "已达到预警阈值"
              : b.value.limit
                ? "额度使用正常"
                : "尚未设置额度"} · {report.budgets.enforce
            ? "达到额度后阻止后续生成"
            : "仅监控提醒"}
        </p>
      </section>{/each}
  </div>
  {#if report.totals.unreportedRequests}<div class="usage-note">
      有 {report.totals.unreportedRequests} 次请求未返回总 token 用量，统计仅包含已上报部分，不将缺失值计作
      0。额度判断也仅依据已记录用量。
    </div>{/if}{#if report.skippedRecords}<div class="err">
      有 {report.skippedRecords} 条损坏的运行记录未计入统计，请检查服务器存储。
    </div>{/if}
  <section class="panel">
    <div class="panel-head">
      <h2>每日用量趋势</h2>
      <span class="muted"
        >{n(report.totals.total)} 已记录 · 缓存 {n(report.totals.cached)} · 推理 {n(
          report.totals.reasoning,
        )}</span
      >
    </div>
    {#if !report.totals.requests}<div class="empty">
        <h3>还没有模型请求记录</h3>
        <p class="muted">
          使用 AI 编辑、对话或连接测试后，用量会自动记录在这里。
        </p>
        <a href="#/ai-settings">配置并测试模型 →</a>
      </div>{:else}<div
        class="usage-chart"
        role="img"
        aria-label="每日已上报 token 用量柱状图"
      >
        {#each report.daily as day}<div
            class="chart-day"
            title={`${day.date} · ${day.total} tokens · ${day.requests} 次调用 · ${day.unreportedRequests} 次未上报`}
          >
            <span>{report.days <= 7 ? n(day.total) : ""}</span>
            <div class="bar-space">
              <div
                class="bar"
                style={`height:${day.total ? Math.max(2, (day.total / maximum) * 100) : 0}%`}
              ></div>
            </div>
            <small>{day.date.slice(5)}</small>
          </div>{/each}
      </div>{/if}
  </section>
  <section class="panel table-section">
    <div class="panel-head">
      <h2>按模型统计</h2>
      <span class="muted">当前筛选范围</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead
          ><tr
            ><th>模型</th><th>请求</th><th>输入</th><th>输出</th><th
              >总 Tokens</th
            ><th>未上报</th><th>失败</th></tr
          ></thead
        ><tbody
          >{#each report.models as m}<tr
              ><td class="model-cell">{m.model}</td><td>{m.requests}</td><td
                >{known(m.input, m.missingInput, m.requests)}</td
              ><td>{known(m.output, m.missingOutput, m.requests)}</td><td
                >{n(m.total)}</td
              ><td>{m.unreportedRequests}</td><td>{m.failed}</td></tr
            >{/each}</tbody
        >
      </table>
      {#if !report.models.length}<div class="empty">暂无模型统计</div>{/if}
    </div>
  </section>
  <section class="panel table-section">
    <div class="panel-head">
      <h2>最近请求</h2>
      <span class="muted">当前范围最近 50 条 · 不记录正文或密钥</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead
          ><tr
            ><th>时间 / 模型</th><th>用途</th><th>状态</th><th>输入 / 输出</th
            ><th>总 Tokens</th><th>耗时</th></tr
          ></thead
        ><tbody
          >{#each report.recent as r}<tr
              ><td class="model-cell"
                >{r.model}<small
                  >{new Date(r.time).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })} · {r.provider}</small
                ></td
              ><td
                >{r.kind === "chat"
                  ? "对话"
                  : r.kind === "daily"
                    ? "GitHub 日报"
                    : r.kind === "test"
                      ? "连接测试"
                      : "编辑助手"}</td
              ><td
                ><span
                  class="badge"
                  class:draft={!r.ok}
                  title={r.errorCode ?? ""}>{r.ok ? "成功" : "失败"}</span
                >{#if r.errorCode}<small class="code">{r.errorCode}</small
                  >{/if}</td
              ><td>{n(r.input)} / {n(r.output)}</td><td
                >{r.total === null ? "未上报" : n(r.total)}</td
              ><td>{(r.durationMs / 1000).toFixed(2)}s</td></tr
            >{/each}</tbody
        >
      </table>
      {#if !report.recent.length}<div class="empty">暂无请求记录</div>{/if}
    </div>
  </section>
  <p class="hint" style="margin-top:20px">
    数据来自接口响应的 usage 字段，只统计此 CMS
    发起的调用，不代表服务商账户总账单。缓存和推理 token
    属于细分项，不重复加到总量中。进行中的请求可能超出配置额度。
  </p>
{:else if loading}<div class="empty">正在读取用量…</div>{/if}

<style>
  .usage-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
    flex-wrap: wrap;
    margin-bottom: 23px;
  }
  .usage-toolbar select,
  .usage-toolbar button {
    font-size: 11px;
  }
  .budget-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 24px;
  }
  .budget {
    padding: 20px;
  }
  .budget > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    color: #7d8aa6;
  }
  .budget strong {
    font-weight: 500;
  }
  .budget span {
    font-size: 11px;
  }
  .budget progress {
    width: 100%;
    height: 7px;
    margin-top: 17px;
    accent-color: #7d8bd1;
  }
  .budget p {
    font-size: 10px;
    color: #a1acc3;
    line-height: 1.8;
    margin: 9px 0 0;
  }
  .budget.alert {
    border-color: #ead7af;
    background: #fffcf5;
  }
  .budget.alert progress {
    accent-color: #cba356;
  }
  .usage-note {
    background: #fff8eb;
    border: 1px solid #eee0c6;
    border-radius: 9px;
    color: #b39b6c;
    font-size: 12px;
    line-height: 1.9;
    padding: 15px;
    margin-bottom: 23px;
  }
  .usage-chart {
    display: flex;
    gap: 8px;
    overflow: auto;
    padding: 25px 24px;
  }
  .chart-day {
    flex: 1;
    min-width: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .chart-day > span {
    font-size: 10px;
    color: #a0adca;
    min-height: 14px;
  }
  .bar-space {
    height: 145px;
    width: 100%;
    max-width: 55px;
    display: flex;
    align-items: flex-end;
    background: #fafbfe;
    border-radius: 5px;
  }
  .bar {
    width: 100%;
    background: linear-gradient(#abb4e5, #7989cf);
    border-radius: 4px;
  }
  .chart-day small {
    font-size: 9px;
    color: #a4b0c8;
    white-space: nowrap;
  }
  .table-section {
    margin-top: 24px;
  }
  .model-cell {
    color: #697c9c;
    max-width: 320px;
    overflow-wrap: anywhere;
  }
  .model-cell small,
  .code {
    display: block;
    font-size: 9px;
    color: #a4afc4;
    margin-top: 7px;
    line-height: 1.6;
  }
  .table-section td {
    white-space: nowrap;
    font-size: 11px;
  }
  .table-section .model-cell {
    white-space: normal;
  }
  .table-section .panel-head .muted,
  .panel-head .muted {
    font-size: 10px;
    text-align: right;
  }
  @media (max-width: 760px) {
    .budget-grid {
      grid-template-columns: 1fr;
    }
    .usage-toolbar .action-row {
      flex-wrap: wrap;
    }
    .usage-toolbar select {
      max-width: 160px;
    }
    .usage-chart {
      padding: 20px 15px;
    }
    .chart-day {
      min-width: 24px;
    }
    .stats-grid .stat-card strong {
      font-size: 23px;
    }
  }
</style>
