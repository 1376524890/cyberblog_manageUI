<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    setCurrentUser,
    type CurrentUser,
    currentRoute,
    hasUnsavedChanges,
    setUnsavedChanges,
  } from "./lib/api.ts";
  import { collections, type Collection, messageOf } from "./lib/content.ts";
  import Icon from "./components/Icon.svelte";
  import Accounts from "./pages/Accounts.svelte";
  import DraftList from "./pages/DraftList.svelte";
  import Login from "./pages/Login.svelte";
  import PostList from "./pages/PostList.svelte";
  import PostEditor from "./pages/PostEditor.svelte";
  import PostNew from "./pages/PostNew.svelte";
  import Overview from "./pages/Overview.svelte";
  import SeriesPage from "./pages/SeriesPage.svelte";
  import PublishPage from "./pages/PublishPage.svelte";
  import AIWorkspace from "./pages/AIWorkspace.svelte";
  import GitHubDaily from "./pages/GitHubDaily.svelte";
  import AIUsage from "./pages/AIUsage.svelte";
  import AISettings from "./pages/AISettings.svelte";
  import "./style.css";
  let user: CurrentUser = { username: "", role: "creator" };
  $: admin = user.role === "admin";
  let routeQuery = location.hash.split("?")[1] || "";
  $: draftCollection = (new URLSearchParams(routeQuery).get("collection") ||
    "posts") as Collection;
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
    section === "accounts"
      ? "账号与邀请码"
      : section === "drafts"
        ? admin
          ? "投稿审核"
          : "我的草稿"
        : section === "github-daily"
          ? "GitHub 日报"
          : section === "ai"
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
    if (!authed || user.role !== "admin") return;
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
    const nextQuery = location.hash.split("?")[1] || "";
    if (next === route && nextQuery === routeQuery) return;
    if (
      hasUnsavedChanges() &&
      !confirm("有尚未保存的修改，确定离开当前页面？")
    ) {
      history.replaceState(
        null,
        "",
        `#${route}${routeQuery ? "?" + routeQuery : ""}`,
      );
      return;
    }
    setUnsavedChanges(false);
    route = next;
    routeQuery = nextQuery;
  }
  onMount(() => {
    window.addEventListener("hashchange", changeRoute);
    window.addEventListener("cms:saved", refresh);
    void api
      .get<CurrentUser>("/auth/me")
      .then((identity) => {
        user = identity;
        setCurrentUser(identity);
        if (
          identity.role === "creator" &&
          !["drafts", "new", "ai"].includes(currentRoute().split("/")[1])
        ) {
          location.hash = "/drafts";
          route = "/drafts";
        }
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
        <a class:active={section === "drafts"} href="#/drafts"
          ><Icon name="article" />{admin ? "投稿审核" : "我的草稿"}</a
        >
        {#if admin}
          <a class:active={section === "ai"} href="#/ai"
            ><Icon name="sparkles" />AI 工作台<span class="new-badge">AI</span
            ></a
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
          <a class:active={section === "accounts"} href="#/accounts"
            ><Icon name="users" />账号与邀请码</a
          >
          <a class:active={section === "github-daily"} href="#/github-daily"
            ><Icon name="activity" />GitHub 日报</a
          >
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
        {:else}
          <a class:active={section === "ai"} href="#/ai"
            ><Icon name="sparkles" />AI 工作台</a
          >
          <div class="nav-label">选择现有板块投稿</div>
          {#each Object.entries(collections) as [key, value]}<a
              href={`#/drafts/new?collection=${key}`}
              ><Icon name={value.icon} />{value.label}</a
            >{/each}
        {/if}
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
            >{admin ? "管理员" : "创作者"}<small>{user.username}</small></span
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
          {#if admin}<a class="ai-command-link" href="#/ai">✦ AI 指令</a><a
              class="sync-status"
              class:warning={pending === null || !!gitError}
              href="#/publish"
              ><span class="status-dot"></span>{pending === null
                ? "状态待确认"
                : pending
                  ? `${pending} 个提交待发布`
                  : "仓库已同步"}</a
            >{:else}<span class="muted">创作 → 提交待发布 → 管理员审核</span
            >{/if}<button
            class="mobile-logout icon-button"
            aria-label="退出登录"
            on:click={logout}><Icon name="logout" size={17} /></button
          >
        </div>
      </header>
      <main>
        {#if notice}<div class="err" role="alert">{notice}</div>{/if}
        {#key `${route}?${routeQuery}`}
          {#if section === "drafts"}
            {#if route.split("/")[2]}<PostEditor
                draftId={route.split("/")[2]}
                collection={Object.hasOwn(collections, draftCollection)
                  ? draftCollection
                  : "posts"}
                slug="new"
              />
            {:else}<DraftList {admin} />{/if}
          {:else if section === "ai"}<AIWorkspace />
          {:else if !admin}<DraftList {admin} />
          {:else if section === "github-daily"}<GitHubDaily />
          {:else if section === "accounts"}<Accounts />
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
