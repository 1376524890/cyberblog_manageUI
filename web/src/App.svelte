<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    currentRoute,
    hasUnsavedChanges,
    setUnsavedChanges,
  } from "./lib/api.ts";
  import { collections, type Collection, messageOf } from "./lib/content.ts";
  import Icon from "./components/Icon.svelte";
  import Login from "./pages/Login.svelte";
  import PostList from "./pages/PostList.svelte";
  import PostEditor from "./pages/PostEditor.svelte";
  import PostNew from "./pages/PostNew.svelte";
  import Overview from "./pages/Overview.svelte";
  import SeriesPage from "./pages/SeriesPage.svelte";
  import PublishPage from "./pages/PublishPage.svelte";
  import AIWorkspace from "./pages/AIWorkspace.svelte";
  import AIUsage from "./pages/AIUsage.svelte";
  import AISettings from "./pages/AISettings.svelte";
  import "./style.css";
  let route = currentRoute(),
    authed = false,
    checked = false,
    pending: number | null = null,
    gitError = "",
    notice = "";
  $: section = route.split("/")[1];
  $: collection = (
    Object.keys(collections).includes(section) ? section : "posts"
  ) as Collection;
  $: pageTitle =
    section === "ai"
      ? "AI 工作台"
      : section === "ai-usage"
        ? "Token 用量"
        : section === "ai-settings"
          ? "AI 设置"
          : section === "overview"
            ? "工作台"
            : section === "series"
              ? "系列管理"
              : section === "publish"
                ? "发布中心"
                : collections[collection].label;
  async function refresh() {
    if (!authed) return;
    try {
      const s = await api.get<{
        pendingPushCount: number;
        healthy: boolean;
        lockedReason: string | null;
      }>("/git/status");
      pending = s.healthy ? s.pendingPushCount : null;
      gitError = s.lockedReason ?? "";
    } catch (e) {
      gitError = messageOf(e);
      pending = null;
    }
  }
  async function logout() {
    if (hasUnsavedChanges() && !confirm("有尚未保存的修改，确定退出？")) return;
    try {
      await api.post("/auth/logout");
      setUnsavedChanges(false);
      authed = false;
    } catch (e) {
      notice = messageOf(e);
    }
  }
  function changeRoute() {
    const next = currentRoute();
    if (next === route) return;
    if (
      hasUnsavedChanges() &&
      !confirm("有尚未保存的修改，确定离开当前页面？")
    ) {
      history.replaceState(null, "", `#${route}`);
      return;
    }
    setUnsavedChanges(false);
    route = next;
  }
  onMount(() => {
    window.addEventListener("hashchange", changeRoute);
    window.addEventListener("cms:saved", refresh);
    void api
      .get("/auth/me")
      .then(() => {
        authed = true;
        void refresh();
      })
      .catch(() => {})
      .finally(() => (checked = true));
    const timer = setInterval(refresh, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", changeRoute);
      window.removeEventListener("cms:saved", refresh);
    };
  });
</script>

{#if !checked}<div class="boot">正在连接内容工作台…</div>
{:else if !authed}<Login />
{:else}
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#/overview"
        ><span class="brand-mark"><Icon name="code" size={23} /></span><span
          >Cyber先锋社<small>CONTENT STUDIO</small></span
        ></a
      >
      <div class="workspace-label">管理空间 <span> / </span> 博客</div>
      <nav aria-label="主导航">
        <a class:active={section === "ai"} href="#/ai"
          ><Icon name="sparkles" />AI 工作台<span class="new-badge">AI</span></a
        >
        <a class:active={section === "overview"} href="#/overview"
          ><Icon name="dashboard" />工作台</a
        >
        <div class="nav-label">内容管理</div>
        {#each Object.entries(collections) as [key, value]}<a
            class:active={section === key ||
              (key === "posts" && section === "new")}
            href={`#/${key}`}><Icon name={value.icon} />{value.label}</a
          >{/each}
        <a class:active={section === "series"} href="#/series"
          ><Icon name="series" />系列管理</a
        >
        <div class="nav-label">站点与助手</div>
        <a class:active={section === "ai-usage"} href="#/ai-usage"
          ><Icon name="activity" />Token 用量</a
        >
        <a class:active={section === "ai-settings"} href="#/ai-settings"
          ><Icon name="settings" />AI 设置</a
        >
        <a class:active={section === "publish"} href="#/publish"
          ><Icon name="publish" />发布中心{#if pending}<span class="nav-count"
              >{pending}</span
            >{/if}</a
        >
      </nav>
      <div class="sidebar-bottom">
        <a
          href="https://www.cyberpioneer.club/"
          target="_blank"
          rel="noreferrer"
          ><span>访问博客<small>www.cyberpioneer.club</small></span><Icon
            name="arrow"
            size={17}
          /></a
        >
        <div class="account">
          <span class="avatar">C</span><span
            >管理员<small>Cyber先锋社</small></span
          ><button class="icon-button" aria-label="退出登录" on:click={logout}
            ><Icon name="logout" size={18} /></button
          >
        </div>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div>管理空间 <span>/</span> <strong>{pageTitle}</strong></div>
        <div class="topbar-actions">
          <a class="ai-command-link" href="#/ai">✦ AI 指令</a><a
            class="sync-status"
            class:warning={pending === null || !!gitError}
            href="#/publish"
            ><span class="status-dot"></span>{pending === null
              ? "状态待确认"
              : pending
                ? `${pending} 个提交待发布`
                : "仓库已同步"}</a
          ><button
            class="mobile-logout icon-button"
            aria-label="退出登录"
            on:click={logout}><Icon name="logout" size={17} /></button
          >
        </div>
      </header>
      <main>
        {#if notice}<div class="err" role="alert">{notice}</div>{/if}
        {#key route}
          {#if section === "ai"}<AIWorkspace />
          {:else if section === "ai-usage"}<AIUsage
            />{:else if section === "ai-settings"}<AISettings />
          {:else if section === "overview"}<Overview />
          {:else if section === "series"}<SeriesPage />
          {:else if section === "publish"}<PublishPage />
          {:else if route === "/new"}<PostNew />
          {:else if route.split("/")[2]}<PostEditor
              {collection}
              slug={decodeURIComponent(route.split("/")[2])}
            />
          {:else}<PostList {collection} />{/if}
        {/key}
      </main>
      <footer>CYBERPIONEER <span>探索 · 记录 · 分享</span></footer>
    </div>
  </div>
{/if}
