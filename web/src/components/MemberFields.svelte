<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { api, contentSaved } from "../lib/api.ts";
  import { messageOf } from "../lib/content.ts";
  interface MemberLink {
    label: string;
    icon?: string;
    value: string;
  }
  export let status = "member",
    tags = "",
    image = "",
    lang = "",
    slug = "",
    isNew = false;
  export let order: number | undefined = undefined;
  export let links: MemberLink[] = [];
  const dispatch = createEventDispatcher();
  const statuses = [
    { value: "member", label: "社团成员" },
    { value: "在校", label: "在校成员" },
    { value: "已毕业", label: "毕业校友" },
    { value: "指导老师", label: "指导老师" },
    { value: "嘉宾", label: "嘉宾 / 贡献者" },
    { value: "archived", label: "归档" },
  ];
  const roles = [
    "站长",
    "社长",
    "副社长",
    "骨干成员",
    "普通成员",
    "指导老师",
    "校友",
  ];
  const skills = [
    "Python",
    "C++",
    "Java",
    "Web 开发",
    "网络安全",
    "CTF",
    "AI 应用",
    "运维",
    "UI / UX",
  ];
  const presets = [
    {
      label: "GitHub",
      icon: "fa7-brands:github",
      placeholder: "https://github.com/username",
    },
    {
      label: "个人博客",
      icon: "fa7-solid:globe",
      placeholder: "https://example.com",
    },
    {
      label: "邮箱",
      icon: "fa7-solid:envelope",
      placeholder: "mailto:name@example.com",
    },
    {
      label: "Bilibili",
      icon: "fa7-brands:bilibili",
      placeholder: "https://space.bilibili.com/…",
    },
    { label: "自定义", icon: "", placeholder: "https://…" },
  ];
  let uploading = false,
    error = "";
  $: selected = tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
  $: role = selected.find((t) => roles.includes(t)) ?? "";
  $: avatar = image.startsWith("./images/" + slug + "/")
    ? `/api/v1/projects/${encodeURIComponent(slug)}/images/${encodeURIComponent(image.split("/").pop() ?? "")}`
    : /^(https?:\/\/|\/(?!\/))/.test(image)
      ? image
      : "";
  function toggle(value: string) {
    tags = (
      selected.includes(value)
        ? selected.filter((t) => t !== value)
        : [...selected, value]
    ).join(", ");
  }
  function setRole(value: string) {
    tags = [
      ...selected.filter((t) => !roles.includes(t)),
      ...(value ? [value] : []),
    ].join(", ");
  }
  function addLink() {
    links = [
      ...links,
      { label: "GitHub", icon: "fa7-brands:github", value: "" },
    ];
  }
  function preset(index: number, value: string) {
    const p = presets.find((p) => p.label === value);
    if (!p) return;
    links = links.map((l, i) =>
      i === index
        ? { ...l, label: p.label === "自定义" ? "" : p.label, icon: p.icon }
        : l,
    );
  }
  async function upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    error = "";
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("头像不能超过 5MB");
      const form = new FormData();
      form.append("file", file);
      const r = await api.upload<{ refPath: string }>(
        `/projects/${encodeURIComponent(slug)}/images`,
        form,
      );
      image = r.refPath;
      dispatch("upload");
      contentSaved();
    } catch (e) {
      error = messageOf(e);
    } finally {
      uploading = false;
      input.value = "";
    }
  }
</script>

<div class="member-fields">
  <div class="field-section">
    <h3>身份与展示</h3>
    <div class="form-grid">
      <label class="form-field"
        >成员状态<select bind:value={status}
          ><option value="">不显示状态</option>{#each statuses as s}<option
              value={s.value}>{s.label}</option
            >{/each}{#if status && !statuses.some((s) => s.value === status)}<option
              value={status}>{status}（现有值）</option
            >{/if}</select
        ></label
      >
      <label class="form-field"
        >社内角色<select
          value={role}
          on:change={(e) => setRole(e.currentTarget.value)}
          ><option value="">未设置</option>{#each roles as r}<option value={r}
              >{r}</option
            >{/each}</select
        ></label
      >
      <label class="form-field"
        >展示排序<input type="number" step="1" bind:value={order} /><small
          >数值越大越靠前</small
        ></label
      >
      <label class="form-field"
        >资料语言<select bind:value={lang}
          ><option value="">跟随站点</option><option value="zh-CN"
            >简体中文</option
          ><option value="en">English</option
          >{#if lang && !["zh-CN", "en"].includes(lang)}<option value={lang}
              >{lang}</option
            >{/if}</select
        ></label
      >
    </div>
  </div>
  <div class="field-section">
    <h3>技能与兴趣</h3>
    <div class="skill-chips">
      {#each skills as skill}<button
          type="button"
          class:selected={selected.includes(skill)}
          aria-pressed={selected.includes(skill)}
          on:click={() => toggle(skill)}
          >{selected.includes(skill) ? "✓" : "＋"} {skill}</button
        >{/each}
    </div>
    <label class="form-field"
      >全部标签（也可自定义）<input
        bind:value={tags}
        placeholder="成员主页, 站长, Python"
      /></label
    >
  </div>
  <div class="field-section">
    <h3>头像 / 展示图</h3>
    <div class="avatar-edit">
      {#if avatar}<img src={avatar} alt="成员头像预览" />{:else}<div
          class="avatar-placeholder"
        >
          头像
        </div>{/if}
      <div>
        <label class="button"
          >{uploading ? "上传中…" : "上传头像"}<input
            class="file"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.avif,.gif"
            disabled={isNew || uploading}
            on:change={upload}
          /></label
        >
        <p class="hint">
          {isNew
            ? "先保存成员，再上传本地头像。"
            : "最大 5MB，保存成员时提交图片。"}
        </p>
      </div>
    </div>
    <label class="form-field"
      >图片路径或 URL<input
        bind:value={image}
        placeholder="https://… 或仓库图片路径"
      /></label
    >{#if error}<div class="err" role="alert">{error}</div>{/if}
  </div>
  <div class="field-section">
    <div class="section-heading">
      <h3>社交与联系方式</h3>
      <button type="button" on:click={addLink}>＋ 添加链接</button>
    </div>
    <p class="hint">这些链接会公开显示在成员卡片上。</p>
    {#each links as link, i}<div class="link-card">
        <div class="link-card-head">
          <span>链接 {i + 1}</span>
          <div class="action-row">
            <button
              aria-label={`上移链接${i + 1}`}
              disabled={i === 0}
              on:click={() => {
                links = [
                  ...links.slice(0, i - 1),
                  links[i],
                  links[i - 1],
                  ...links.slice(i + 1),
                ];
              }}>↑</button
            ><button
              class="danger"
              aria-label={`删除链接${i + 1}`}
              on:click={() => (links = links.filter((_, index) => index !== i))}
              >移除</button
            >
          </div>
        </div>
        <div class="form-grid">
          <label class="form-field"
            >平台<select
              value={presets.some((p) => p.label === link.label)
                ? link.label
                : "自定义"}
              on:change={(e) => preset(i, e.currentTarget.value)}
              >{#each presets as p}<option value={p.label}>{p.label}</option
                >{/each}</select
            ></label
          ><label class="form-field"
            >显示名称<input
              bind:value={link.label}
              placeholder="链接名称"
            /></label
          ><label class="form-field wide"
            >链接地址<input
              bind:value={link.value}
              placeholder={presets.find((p) => p.label === link.label)
                ?.placeholder ?? "https://…"}
            /></label
          ><label class="form-field wide"
            >图标<select bind:value={link.icon}
              ><option value="">名称首字母</option
              >{#each presets.filter((p) => p.icon) as p}<option value={p.icon}
                  >{p.label} 图标</option
                >{/each}{#if link.icon && !presets.some((p) => p.icon === link.icon)}<option
                  value={link.icon}>{link.icon}（现有值）</option
                >{/if}</select
            ></label
          >
        </div>
      </div>{/each}
    {#if !links.length}<div class="empty small-empty">
        尚未添加链接。可添加 GitHub、博客、邮箱等公开渠道。
      </div>{/if}
  </div>
</div>

<style>
  .member-fields {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .field-section {
    border-top: 1px solid #edf0f7;
    padding-top: 20px;
  }
  .field-section h3 {
    font-size: 12px;
    color: #667794;
    margin: 0 0 16px;
  }
  .form-grid {
    gap: 13px;
  }
  .form-field small {
    font-size: 10px;
    color: #9ba8bd;
  }
  .skill-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-bottom: 14px;
  }
  .skill-chips button {
    font-size: 10px;
    padding: 6px 9px;
    background: #f8f9fc;
  }
  .skill-chips button.selected {
    background: #eef0ff;
    border-color: #aeb8f4;
    color: #5366df;
  }
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .section-heading h3 {
    margin: 0;
  }
  .section-heading button {
    font-size: 10px;
    padding: 6px 9px;
  }
  .link-card {
    background: #fafbfe;
    border: 1px solid #e8ecf3;
    border-radius: 9px;
    padding: 13px;
    margin-top: 13px;
  }
  .link-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: #8b98b0;
    margin-bottom: 12px;
  }
  .link-card-head button {
    padding: 3px 7px;
    font-size: 10px;
  }
  .avatar-edit {
    display: flex;
    align-items: center;
    gap: 13px;
    margin-bottom: 15px;
  }
  .avatar-edit img,
  .avatar-placeholder {
    width: 62px;
    height: 62px;
    border-radius: 12px;
    object-fit: cover;
    background: #f0f3fa;
  }
  .avatar-placeholder {
    display: grid;
    place-items: center;
    font-size: 12px;
    color: #8f9cb9;
  }
  .avatar-edit p {
    font-size: 10px;
    margin: 7px 0 0;
  }
  .avatar-edit .button {
    font-size: 11px;
    padding: 7px 10px;
    cursor: pointer;
  }
  .file {
    display: none;
  }
  .small-empty {
    padding: 22px 8px;
    font-size: 11px;
    line-height: 1.8;
  }
</style>
