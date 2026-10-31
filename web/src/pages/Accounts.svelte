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
    quota: { used: number; remaining: number; limit: number };
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
      邀请创作者注册独立账号，每人每天 300 万
      token，额度按北京时间每日零点重置。
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
              >今日可用 token</th
            ><th>操作</th></tr
          ></thead
        ><tbody
          >{#each users as user}<tr
              ><td
                >{user.username}{#if user.builtin}<small class="hint"
                    >（内置）</small
                  >{/if}</td
              ><td>{user.role === "admin" ? "管理员" : "创作者"}</td><td
                >{user.active ? "启用" : "已停用"}</td
              ><td>{user.quota.used.toLocaleString()}</td><td
                >{user.quota.remaining.toLocaleString()}</td
              ><td
                >{#if !user.builtin}<button
                    class:danger={user.active}
                    disabled={busy}
                    on:click={() => toggle(user)}
                    >{user.active ? "停用" : "启用"}</button
                  >{:else}<span class="hint">环境配置管理</span>{/if}</td
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
