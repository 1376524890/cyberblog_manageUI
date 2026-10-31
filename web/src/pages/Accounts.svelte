<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api.ts";
  import { messageOf } from "../lib/content.ts";
  interface User {
    id: string;
    username: string;
    role: string;
    active: boolean;
    builtin: boolean;
    createdAt?: string;
    quota: {
      used: number;
      reserved: number;
      remaining: number | null;
      limit: number | null;
      unlimited: boolean;
      customLimit: boolean;
      defaultLimit: number;
    };
  }
  interface Invite {
    id: string;
    suffix: string;
    state: string;
    expiresAt: string;
    usedBy: string | null;
    code?: string;
  }
  let users: User[] = [],
    invites: Invite[] = [],
    generated: Invite[] = [];
  let limits: Record<string, number | undefined> = {};
  let pendingReset: string | null = null;
  let count = 1,
    days = 7,
    busy = false,
    loading = true,
    error = "",
    message = "";
  const states: Record<string, string> = {
    available: "可使用",
    used: "已使用",
    expired: "已过期",
    revoked: "已撤销",
  };
  const date = (v: string) =>
    new Date(v).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  async function load() {
    error = "";
    try {
      const r = await api.get<{ users: User[]; invites: Invite[] }>(
        "/admin/accounts",
      );
      users = r.users;
      limits = Object.fromEntries(
        users.map((u) => [u.id, u.quota.limit ?? undefined]),
      );
      invites = r.invites.reverse();
    } catch (e) {
      error = messageOf(e);
    } finally {
      loading = false;
    }
  }
  async function generate() {
    if (busy) return;
    busy = true;
    error = "";
    message = "";
    try {
      generated = (
        await api.post<{ items: Invite[] }>("/admin/invites", {
          count: Number(count),
          days: Number(days),
        })
      ).items;
      await load();
    } catch (e) {
      error = messageOf(e);
    } finally {
      busy = false;
    }
  }
  async function revoke(invite: Invite) {
    if (busy) return;
    busy = true;
    try {
      await api.post(`/admin/invites/${invite.id}/revoke`, {});
      generated = generated.filter((i) => i.id !== invite.id);
      await load();
    } catch (e) {
      error = messageOf(e);
    } finally {
      busy = false;
    }
  }
  async function toggle(user: User) {
    if (busy) return;
    if (
      user.active &&
      !confirm(
        `停用 ${user.username} 后，该账号会立即退出并无法登录，确定停用？`,
      )
    )
      return;
    busy = true;
    try {
      await api.put(`/admin/users/${user.id}`, { active: !user.active });
      await load();
    } catch (e) {
      error = messageOf(e);
    } finally {
      busy = false;
    }
  }
  async function saveLimit(user: User, restore = false) {
    const limit = limits[user.id];
    if (
      busy ||
      (!restore &&
        (limit === undefined ||
          !Number.isSafeInteger(limit) ||
          limit < 0 ||
          limit > 1_000_000_000))
    )
      return;
    busy = true;
    error = "";
    message = "";
    try {
      const quota = await api.put<User["quota"]>(
        `/admin/users/${user.id}/quota`,
        { limit: restore ? null : limit },
      );
      users = users.map((u) => (u.id === user.id ? { ...u, quota } : u));
      limits = { ...limits, [user.id]: quota.limit ?? undefined };
      message = `已${restore ? "恢复" : "调整"} ${user.username} 的每日额度：${quota.limit?.toLocaleString()} token`;
    } catch (e) {
      error = messageOf(e);
    } finally {
      busy = false;
    }
  }
  async function resetQuota(user: User) {
    if (busy) return;
    busy = true;
    error = "";
    message = "";
    try {
      const quota = await api.post<User["quota"]>(
        `/admin/users/${user.id}/quota/reset`,
        {},
      );
      users = users.map((u) => (u.id === user.id ? { ...u, quota } : u));
      message = `已重置 ${user.username} 的今日用量`;
    } catch (e) {
      error = messageOf(e);
    } finally {
      busy = false;
      pendingReset = null;
    }
  }
  async function copy(text: string, label = "邀请码") {
    try {
      await navigator.clipboard.writeText(text);
      message = `已复制${label}`;
    } catch {
      message = "复制失败，请选中邀请码手动复制。";
    }
  }
  onMount(load);
</script>

<div class="page-heading">
  <div>
    <div class="eyebrow">ADMIN / ACCOUNTS</div>
    <h1>账号与邀请码</h1>
    <p class="muted">
      管理员不限额；创作者默认每日 300 万
      token，可调整每日额度或重置今日用量。北京时间零点自动重置。
    </p>
  </div>
  <button disabled={busy || loading} on:click={load}>刷新</button>
</div>
{#if error}<div class="err" role="alert">{error}</div>{/if}{#if message}<div
    class="msg"
    role="status"
  >
    {message}
  </div>{/if}
<section class="panel invite-panel">
  <div class="panel-head">
    <h2>生成邀请码</h2>
    <button on:click={() => copy(`${location.origin}/#/register`, "注册链接")}
      >复制注册链接</button
    >
  </div>
  <div class="panel-body">
    <div class="action-row">
      <label class="form-field"
        >数量<input type="number" min="1" max="20" bind:value={count} /></label
      ><label class="form-field"
        >有效期<select bind:value={days}
          ><option value={1}>1 天</option><option value={7}>7 天</option><option
            value={30}>30 天</option
          ></select
        ></label
      ><button
        class="primary"
        disabled={busy || count < 1 || count > 20}
        on:click={generate}>{busy ? "处理中…" : "生成新邀请码"}</button
      >
    </div>
    <p class="hint">
      每个邀请码只能注册一次。完整邀请码仅在生成时展示，请复制后交给对应创作者；后续可以撤销未使用的邀请码。
    </p>
    {#each generated as invite}<div class="invite-code">
        <code>{invite.code}</code><button on:click={() => copy(invite.code!)}
          >复制</button
        ><small>有效至 {date(invite.expiresAt)}</small>
      </div>{/each}
  </div>
</section>
<section class="panel">
  <div class="panel-head"><h2>创作者与管理员 · {users.length}</h2></div>
  {#if loading}<div class="empty">正在读取账号…</div>{:else}<div
      class="table-wrap"
    >
      <table>
        <thead
          ><tr
            ><th>账号</th><th>身份</th><th>状态</th><th>今日已用 token</th><th
              >每日额度</th
            ><th>今日可用 token</th><th>操作</th></tr
          ></thead
        ><tbody
          >{#each users as user}<tr
              ><td
                >{user.username}{#if user.builtin}<small class="hint"
                    >（内置）</small
                  >{/if}</td
              ><td>{user.role === "admin" ? "管理员" : "创作者"}</td><td
                >{user.active ? "启用" : "已停用"}</td
              ><td
                >{user.quota.used.toLocaleString()}{#if user.quota.reserved}<small
                    class="hint"
                    >（处理中 {user.quota.reserved.toLocaleString()}）</small
                  >{/if}</td
              ><td>
                {#if user.quota.unlimited}<span class="badge">不限额</span
                  >{:else}<div class="quota-edit">
                    <input
                      type="number"
                      min="0"
                      max="1000000000"
                      step="1"
                      aria-label={`${user.username} 的每日 token 额度`}
                      bind:value={limits[user.id]}
                    /><button
                      disabled={busy ||
                        limits[user.id] === undefined ||
                        !Number.isSafeInteger(limits[user.id]) ||
                        limits[user.id]! < 0 ||
                        limits[user.id]! > 1000000000 ||
                        limits[user.id] === user.quota.limit}
                      on:click={() => saveLimit(user)}>保存额度</button
                    >
                  </div>
                  <small class="hint"
                    >{user.quota.customLimit ? "自定义额度" : "默认额度"} · 0 表示暂停
                    AI</small
                  >{/if}
              </td><td
                >{user.quota.unlimited
                  ? "不限额"
                  : user.quota.remaining?.toLocaleString()}</td
              ><td
                ><div class="quota-actions">
                  {#if !user.quota.unlimited}<button
                      disabled={busy}
                      on:click={() => (pendingReset = user.id)}
                      >重置今日用量</button
                    >{#if user.quota.customLimit}<button
                        disabled={busy}
                        on:click={() => saveLimit(user, true)}
                        >恢复默认额度</button
                      >{/if}{/if}
                  {#if pendingReset === user.id}<div
                      class="reset-confirm"
                      role="group"
                      aria-label={`确认重置 ${user.username} 的用量`}
                    >
                      <small>清零今日已用额度，保留处理中请求。</small><button
                        class="primary"
                        disabled={busy}
                        on:click={() => resetQuota(user)}>确认重置</button
                      ><button
                        disabled={busy}
                        on:click={() => (pendingReset = null)}>取消</button
                      >
                    </div>{/if}
                  {#if !user.builtin}<button
                      class:danger={user.active}
                      disabled={busy}
                      on:click={() => toggle(user)}
                      >{user.active ? "停用" : "启用"}</button
                    >{:else}<span class="hint">环境配置管理</span>{/if}
                </div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>{/if}
</section>
<section class="panel">
  <div class="panel-head"><h2>邀请码记录</h2></div>
  {#if !invites.length}<div class="empty">
      还没有邀请码，点击上方按钮生成。
    </div>{:else}<div class="table-wrap">
      <table>
        <thead
          ><tr
            ><th>邀请码尾号</th><th>状态</th><th>有效期至</th><th>注册账号</th
            ><th></th></tr
          ></thead
        ><tbody
          >{#each invites as invite}<tr
              ><td>…{invite.suffix}</td><td>{states[invite.state]}</td><td
                >{date(invite.expiresAt)}</td
              ><td>{invite.usedBy ?? "—"}</td><td
                >{#if invite.state === "available"}<button
                    disabled={busy}
                    on:click={() => revoke(invite)}>撤销</button
                  >{/if}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>{/if}
</section>

<style>
  .reset-confirm {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    align-items: center;
    padding: 8px;
    border: 1px solid #dfe5f1;
    border-radius: 6px;
  }
  .quota-edit,
  .quota-actions {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    align-items: center;
  }
  .quota-edit input {
    width: 135px;
  }
  .quota-actions button {
    white-space: nowrap;
  }
  .panel {
    margin-bottom: 22px;
  }
  .invite-panel .action-row {
    align-items: flex-end;
  }
  .invite-panel input {
    width: 100px;
  }
  .invite-code {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    padding: 14px;
    background: #f4f6fc;
    border-radius: 8px;
    margin-top: 12px;
    overflow-wrap: anywhere;
  }
  .invite-code small {
    color: #8491a7;
  }
  .invite-code code {
    user-select: all;
    font-size: 14px;
  }
  .hint {
    font-size: 11px;
  }
</style>
