<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api.ts";
  import { messageOf } from "../lib/content.ts";
  type Run = {
    date: string;
    startedAt: string;
    finishedAt?: string;
    state: string;
    progress: string;
    error?: string;
    slug?: string;
    attempts: number;
    model?: string;
    ranking?: { name: string; rank: number; todayStars: number | null }[];
  };
  type Status = {
    enabled: boolean;
    running: boolean;
    timezone: string;
    schedule: string;
    nextRunAt: string | null;
    source: string;
    diagramEngine: string;
    runs: Run[];
  };
  let state: Status | null = null,
    error = "",
    message = "",
    busy = false;
  const time = (value?: string | null) =>
    value
      ? new Date(value).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        })
      : "—";
  async function load() {
    try {
      state = await api.get<Status>("/ai/daily");
    } catch (e) {
      error = messageOf(e);
    }
  }
  async function toggle() {
    if (!state) return;
    busy = true;
    error = "";
    try {
      state = await api.put<Status>("/ai/daily", { enabled: !state.enabled });
      message = state.enabled
        ? "已开启每天 08:00 生成，完成后仅保存草稿。"
        : "已暂停后续自动生成；进行中的任务会完成。";
    } catch (e) {
      error = messageOf(e);
    } finally {
      busy = false;
    }
  }
  async function run() {
    busy = true;
    error = "";
    try {
      const r = await api.post<{ started: boolean; reason?: string }>(
        "/ai/daily/run",
        {},
      );
      message = r.started
        ? "已在服务器开始生成，可以离开此页。"
        : (r.reason ?? "任务状态已更新");
      await load();
    } catch (e) {
      error = messageOf(e);
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  });
</script>

<div class="daily-head">
  <div>
    <p class="eyebrow">GITHUB / DAILY</p>
    <h1>每天，读懂五个开源项目</h1>
    <p class="muted">
      从 GitHub 日榜到源码与结构图，让 AI 完成初稿，你来决定何时发布。
    </p>
  </div>
  <a class="button" href="#/ai">前往 AI 工作台 ↗</a>
</div>
{#if error}<div class="err" role="alert">{error}</div>{/if}
{#if message}<div class="ok" role="status">{message}</div>{/if}
{#if state}
  <section class="daily-hero panel">
    <div>
      <span class="daily-badge"
        >{state.enabled ? "自动生成已开启" : "自动生成已暂停"}</span
      >
      <h2>北京时间 · 每天 08:00</h2>
      <p>下一次计划：{time(state.nextRunAt)}</p>
      <p class="muted">
        任务在服务器运行，关闭浏览器不影响执行。仅创建草稿，不推送、不公开发布。
      </p>
    </div>
    <div class="daily-buttons">
      <button disabled={busy} on:click={toggle}
        >{state.enabled ? "暂停自动生成" : "开启自动生成"}</button
      ><button class="primary" disabled={busy || state.running} on:click={run}
        >{state.running ? "正在生成…" : "生成今日草稿 / 重试"}</button
      >
    </div>
  </section>
  <div class="daily-grid">
    <section class="panel daily-card">
      <h2>榜单与证据</h2>
      <p>
        <a href={state.source} target="_blank" rel="noreferrer"
          >GitHub Trending · daily ↗</a
        >
      </p>
      <p class="muted">
        保留抓取时前五名的顺序，记录当日新增与总星标。逐个读取固定提交的
        README、清单和关键源码样本；不安装或执行仓库代码。
      </p>
    </section>
    <section class="panel daily-card">
      <h2>博客与配图</h2>
      <p>{state.diagramEngine}</p>
      <p class="muted">
        每个项目都有详细的功能介绍与实现讲解，配中文标注的 PNG
        架构图片；图片随文章一起保存。模型用量计入
        <a href="#/ai-usage">Token 用量</a>，沿用
        <a href="#/ai-settings">AI 设置</a>及额度。
      </p>
    </section>
  </div>
  <section class="panel daily-card">
    <h2>运行记录</h2>
    <p class="muted">
      每日去重，已生成的草稿不会被重跑覆盖。失败最多自动重试 2 次，间隔至少 10
      分钟；服务恢复后补跑当天遗漏的任务。
    </p>
    {#if !state.runs.length}<p>尚无运行记录。开启计划或先生成今日草稿。</p>{/if}
    {#each state.runs as run}<article class="daily-run">
        <div class="daily-run-title">
          <strong>{run.date}</strong><span class="daily-badge"
            >{run.state === "done"
              ? "草稿已生成"
              : run.state === "failed"
                ? "生成失败"
                : "正在生成"}</span
          >{#if run.slug}<a class="button" href={`#/posts/${run.slug}`}
              >查看草稿 ↗</a
            >{/if}
        </div>
        <p>{run.progress}</p>
        {#if run.error}<p class="err">{run.error}</p>{/if}
        <p class="muted">
          开始 {time(run.startedAt)} · 结束 {time(run.finishedAt)} · 第 {run.attempts}
          次尝试{#if run.model}
            · {run.model}{/if}
        </p>
        {#if run.ranking}<div class="daily-repos">
            {#each run.ranking as repo}<a
                href={`https://github.com/${repo.name}`}
                target="_blank"
                rel="noreferrer"
                >{repo.rank}. {repo.name}<small
                  >今日 +{repo.todayStars ?? "未上报"}</small
                ></a
              >{/each}
          </div>{/if}
      </article>{/each}
  </section>
{:else}<p class="muted">正在读取服务器任务状态…</p>{/if}

<style>
  .daily-head,
  .daily-hero,
  .daily-run-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .daily-head {
    margin-bottom: 26px;
  }
  .daily-head h1 {
    margin: 8px 0 12px;
    font-size: 30px;
    letter-spacing: -1px;
  }
  .muted {
    color: var(--text-muted, #999da9);
    line-height: 1.8;
  }
  .daily-hero {
    padding: 30px;
    background: linear-gradient(115deg, rgba(94, 93, 232, 0.13), transparent);
  }
  .daily-hero h2 {
    margin: 18px 0 12px;
  }
  .daily-buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .daily-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin: 20px 0;
  }
  .daily-card {
    padding: 24px;
  }
  .daily-card h2 {
    font-size: 19px;
    margin: 0 0 15px;
  }
  .daily-badge {
    font-size: 12px;
    border: 1px solid rgba(135, 139, 235, 0.3);
    border-radius: 20px;
    padding: 5px 10px;
    color: #aaaaf5;
  }
  .daily-run {
    border-top: 1px solid rgba(128, 128, 150, 0.2);
    padding: 20px 0;
  }
  .daily-run-title {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .daily-run-title .button {
    margin-left: auto;
  }
  .daily-repos {
    display: grid;
    gap: 8px;
  }
  .daily-repos a {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .daily-repos small {
    color: var(--text-muted, #999da9);
  }
  @media (max-width: 800px) {
    .daily-head,
    .daily-hero {
      align-items: flex-start;
      flex-direction: column;
    }
    .daily-grid {
      grid-template-columns: 1fr;
    }
    .daily-head h1 {
      font-size: 25px;
    }
  }
</style>
