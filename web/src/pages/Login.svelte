<script lang="ts">
  import { api } from "../lib/api.ts";
  import { messageOf } from "../lib/content.ts";
  import Icon from "../components/Icon.svelte";
  let registering = location.hash.startsWith("#/register"),
    inviteCode = "",
    confirmPassword = "";
  let username = "",
    password = "",
    error = "",
    busy = false,
    visible = false;
  async function login() {
    if (busy || !username || !password) return;
    error = "";
    busy = true;
    try {
      if (registering && password !== confirmPassword)
        throw new Error("两次输入的密码不一致");
      await api.post(
        registering ? "/auth/register" : "/auth/login",
        registering
          ? { username, password, inviteCode }
          : { username, password },
      );
      location.hash = "/ai";
      location.reload();
    } catch (e) {
      error = messageOf(e);
      busy = false;
    }
  }
</script>

<div class="login-page">
  <section class="intro">
    <a
      class="login-brand"
      href="https://www.cyberpioneer.club/"
      target="_blank"
      rel="noreferrer"
      ><span class="brand-mark"><Icon name="code" size={23} /></span
      >Cyber先锋社</a
    >
    <div class="intro-copy">
      <span class="eyebrow">THE SPACE FOR YOUR IDEAS</span>
      <h1>保持好奇，<br />让探索发生。</h1>
      <p>
        记录技术的温度，分享前行的足迹。<br />这里是 Cyber先锋社的内容创作空间。
      </p>
      <div class="intro-line"></div>
      <small>探索 · 记录 · 分享</small>
    </div>
    <span class="intro-footer">CYBERPIONEER CLUB / CONTENT STUDIO</span>
    <div class="rings" aria-hidden="true"></div>
  </section>
  <section class="login-form">
    <form on:submit|preventDefault={login}>
      <div class="eyebrow">WELCOME BACK</div>
      <h2>{registering ? "注册创作者账号" : "登录内容工作台"}</h2>
      <p class="muted">
        {registering
          ? "填写管理员提供的邀请码，开始独立创作。"
          : "新的灵感，从这里开始。"}
      </p>
      {#if error}<div class="err" role="alert">{error}</div>{/if}
      <label for="username">账号</label>
      <div class="password-field" style="margin-bottom: 20px">
        <input
          id="username"
          placeholder={registering
            ? "3–40 位字母、数字、下划线或短横线"
            : "请输入账号"}
          autocomplete="username"
          required
          bind:value={username}
        />
      </div>
      <label for="admin-password">登录密码</label>
      <div class="password-field">
        <input
          id="admin-password"
          type={visible ? "text" : "password"}
          placeholder="请输入登录密码"
          autocomplete={registering ? "new-password" : "current-password"}
          minlength={registering ? 12 : undefined}
          maxlength={registering ? 128 : undefined}
          required
          bind:value={password}
        /><button
          type="button"
          on:click={() => (visible = !visible)}
          aria-label={visible ? "隐藏密码" : "显示密码"}
          >{visible ? "隐藏" : "显示"}</button
        >
      </div>
      {#if registering}
        <label for="confirm-password" style="margin-top:20px">确认密码</label>
        <div class="password-field">
          <input
            id="confirm-password"
            type="password"
            autocomplete="new-password"
            required
            minlength="12"
            maxlength="128"
            placeholder="再次输入密码（至少 12 位）"
            bind:value={confirmPassword}
          />
        </div>
        <label for="invite-code" style="margin-top:20px">邀请码</label>
        <div class="password-field">
          <input
            id="invite-code"
            autocomplete="off"
            required
            placeholder="粘贴管理员提供的一次性邀请码"
            bind:value={inviteCode}
          />
        </div>
      {/if}
      <button
        class="primary submit"
        type="submit"
        disabled={busy || !username || !password}
        >{busy
          ? registering
            ? "正在注册…"
            : "正在登录…"
          : registering
            ? "注册并进入工作台"
            : "进入工作台"}<span>→</span></button
      >
      <button
        type="button"
        class="auth-toggle"
        disabled={busy}
        on:click={() => {
          registering = !registering;
          error = "";
          password = "";
          confirmPassword = "";
          location.hash = registering ? "/register" : "/login";
        }}
        >{registering
          ? "已有账号？返回登录"
          : "收到邀请码？注册创作者账号"}</button
      >
      <div class="login-note">
        <span class="status-dot"></span>管理员审核发布 · 创作者投稿
      </div>
    </form>
    <small class="login-copyright"
      >© {new Date().getFullYear()} Cyber先锋社</small
    >
  </section>
</div>

<style>
  .auth-toggle {
    display: block;
    margin: 18px auto 0;
    border: 0;
    background: none;
    color: #6b7ec0;
    font-size: 12px;
  }
  .login-page {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    background: #fff;
  }
  .intro {
    position: relative;
    overflow: hidden;
    background: #edf0fc;
    padding: 44px 55px;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .login-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #3e4c73;
    font-size: 19px;
    font-weight: 650;
    z-index: 1;
  }
  .intro-copy {
    margin: auto 0;
    position: relative;
    z-index: 1;
    padding: 70px 0;
  }
  .intro-copy .eyebrow {
    font-size: 10px;
    color: #9da8c9;
  }
  .intro-copy h1 {
    font-size: clamp(38px, 4.5vw, 65px);
    line-height: 1.5;
    letter-spacing: 1px;
    color: #52638f;
    font-weight: 600;
    margin: 23px 0;
  }
  .intro-copy p {
    font-size: 13px;
    color: #8e9aba;
    line-height: 2.2;
  }
  .intro-line {
    height: 2px;
    width: 30px;
    background: #8a98c7;
    margin: 30px 0;
  }
  .intro-copy small {
    color: #9ba7c6;
    font-size: 11px;
    letter-spacing: 4px;
  }
  .intro-footer {
    font-size: 9px;
    letter-spacing: 2px;
    color: #a6b0cc;
    z-index: 1;
  }
  .rings {
    position: absolute;
    border: 1px solid #dce2f5;
    border-radius: 50%;
    height: 550px;
    width: 550px;
    right: -350px;
    top: 22%;
    box-shadow:
      0 0 0 70px #e4e9f740,
      0 0 0 140px #e4e9f740;
  }
  .login-form {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 40px 24px;
  }
  .login-form form {
    width: 345px;
    max-width: 100%;
  }
  .login-form h2 {
    font-size: 25px;
    font-weight: 600;
    margin: 17px 0 13px;
  }
  .login-form .muted {
    font-size: 12px;
    margin-bottom: 35px;
  }
  .login-form label {
    display: block;
    font-size: 12px;
    color: #6a7892;
    margin-bottom: 10px;
  }
  .password-field {
    display: flex;
    border: 1px solid #e0e5ef;
    border-radius: 8px;
    overflow: hidden;
  }
  .password-field input {
    border: 0;
    flex: 1;
    width: 0;
    padding: 14px;
    font-size: 13px;
  }
  .password-field button {
    border: 0;
    font-size: 11px;
    color: #99a3ba;
    padding: 0 12px;
  }
  .submit {
    width: 100%;
    justify-content: space-between;
    padding: 14px 17px;
    margin-top: 22px;
  }
  .login-note {
    color: #a1aabd;
    font-size: 10px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 6px;
    margin-top: 23px;
  }
  .login-note .status-dot {
    width: 5px;
    height: 5px;
    background: #89bba8;
    border-radius: 50%;
  }
  .login-copyright {
    position: absolute;
    bottom: 30px;
    color: #bac1d0;
    font-size: 10px;
  }
  @media (max-width: 760px) {
    .login-page {
      display: flex;
      flex-direction: column;
    }
    .intro {
      min-height: 0;
      padding: 25px 28px;
    }
    .intro-copy {
      padding: 25px 0 10px;
    }
    .intro-copy h1 {
      font-size: 32px;
      margin: 10px 0;
    }
    .intro-copy h1 br {
      display: none;
    }
    .intro-copy p,
    .intro-line,
    .intro-copy small,
    .intro-footer,
    .intro-copy .eyebrow {
      display: none;
    }
    .login-form {
      padding: 45px 27px 85px;
      flex: 1;
    }
    .login-copyright {
      bottom: 20px;
    }
  }
</style>
