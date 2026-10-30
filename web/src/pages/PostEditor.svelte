<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    api,
    navigate,
    setUnsavedChanges,
    contentSaved,
    ApiClientError,
  } from "../lib/api.ts";
  import {
    collections,
    messageOf,
    today,
    type Collection,
  } from "../lib/content.ts";
  import TagPicker from "../components/TagPicker.svelte";
  import MemberFields from "../components/MemberFields.svelte";
  import TemplatePicker from "../components/TemplatePicker.svelte";
  import AiEditor from "../components/AiEditor.svelte";
  import Icon from "../components/Icon.svelte";
  export let collection: Collection = "posts";
  export let slug = "";
  interface Detail {
    slug: string;
    data: Record<string, unknown>;
    extraFields: Record<string, unknown>;
    body: string;
    version: { head: string; fileMtimeMs: number };
    postUrl: string | null;
    editorMode?: string;
  }
  let post: Detail | null = null,
    loading = true,
    error = "",
    message = "",
    saving = false,
    uploading = false,
    showPreview = false,
    previewHtml = "",
    previewId = 0;
  let title = "",
    published = today(),
    updated = "",
    description = "",
    category = "",
    tags = "",
    series = "",
    seriesOrder: number | undefined = undefined,
    draft = true,
    pinned = false,
    passwordProtected = false,
    password = "",
    passwordHint = "",
    image = "",
    author = "",
    lang = "",
    sourceLink = "",
    licenseName = "",
    licenseUrl = "",
    comment = true,
    locationName = "",
    status = "",
    order: number | undefined = undefined,
    links = "[]",
    body = "",
    filename = "",
    extraJson = "{}";
  let meta: {
      categories: { name: string }[];
      tags?: { name: string }[];
    } | null = null,
    seriesList: { name: string }[] = [],
    images: { name: string; sizeKB: number; refPath: string }[] = [];
  let snapshot = "",
    ready = false,
    showDelete = false,
    deleteText = "";
  let memberLinks: { label: string; icon?: string; value: string }[] = [];
  let undoStack: {
    body: string;
    title: string;
    description: string;
    tags: string;
  }[] = [];
  let bodyArea: HTMLTextAreaElement;
  function applySuggestion(detail: {
    body?: string;
    metadata?: { title: string; description: string; tags: string[] };
  }) {
    undoStack = [...undoStack.slice(-9), { body, title, description, tags }];
    if (detail.body !== undefined) body = detail.body;
    if (detail.metadata) {
      title = detail.metadata.title;
      description = detail.metadata.description;
      tags = detail.metadata.tags.join(", ");
    }
    showPreview = false;
  }
  function undoSuggestion() {
    const prev = undoStack.at(-1);
    if (!prev) return;
    ({ body, title, description, tags } = prev);
    undoStack = undoStack.slice(0, -1);
  }
  async function insert(before: string, after = "") {
    const start = bodyArea?.selectionStart ?? body.length,
      end = bodyArea?.selectionEnd ?? start;
    const selected = body.slice(start, end);
    body = body.slice(0, start) + before + selected + after + body.slice(end);
    await tick();
    bodyArea?.focus();
    bodyArea?.setSelectionRange(
      start + before.length,
      start + before.length + selected.length,
    );
  }

  $: isNew = slug === "new";
  $: state = JSON.stringify({
    title,
    published,
    updated,
    description,
    category,
    tags,
    series,
    seriesOrder,
    draft,
    pinned,
    passwordProtected,
    password,
    passwordHint,
    image,
    author,
    lang,
    sourceLink,
    licenseName,
    licenseUrl,
    comment,
    locationName,
    status,
    order,
    memberLinks,
    body,
    filename,
    extraJson,
  });
  $: dirty = ready && state !== snapshot;
  $: setUnsavedChanges(dirty);
  $: if (showPreview) void preview(body);
  const previewImages = new Map<string, Promise<string>>();
  async function preview(text: string) {
    const id = ++previewId;
    const { marked } = await import("marked");
    const html = await marked.parse(text);
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      const m = src.match(/^\.\/images\/([^/]+)\/([^/]+)$/);
      if (m && m[1] === slug) {
        const url = `${window.location.origin}/api/v1/${collection}/${encodeURIComponent(slug)}/images/${encodeURIComponent(m[2])}`;
        try {
          if (!previewImages.has(url))
            previewImages.set(
              url,
              (async () => {
                const response = await fetch(url, {
                  credentials: "same-origin",
                });
                if (!response.ok) throw new Error("Image unavailable");
                const blob = await response.blob();
                return new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result));
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
              })(),
            );
          img.src = await previewImages.get(url)!;
        } catch {
          previewImages.delete(url);
          img.removeAttribute("src");
        }
      }
    }
    if (id === previewId) previewHtml = doc.body.innerHTML;
  }
  function data() {
    const common = { title, published };
    if (collection === "dynamic")
      return { ...common, pinned, location: locationName };
    if (collection === "spec") {
      const extra = JSON.parse(extraJson);
      if (!extra || typeof extra !== "object" || Array.isArray(extra))
        throw new Error("页面属性必须为 JSON 对象");
      return { ...extra, title, description, lang };
    }
    if (collection === "projects") {
      const link = memberLinks;
      return {
        ...common,
        draft,
        description,
        image,
        tags: tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
        lang,
        status,
        order: order ?? null,
        link,
      };
    }
    return {
      ...common,
      updated: updated || null,
      description,
      category: category || null,
      tags: tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      series,
      seriesOrder: seriesOrder ?? null,
      draft,
      pinned,
      password: passwordProtected ? password : "",
      passwordHint: passwordProtected ? passwordHint : "",
      image,
      author,
      lang,
      sourceLink,
      licenseName,
      licenseUrl,
      comment,
    };
  }
  async function load() {
    loading = true;
    error = "";
    try {
      if (isNew && collection === "projects") {
        status = "member";
        tags = "成员主页";
        order = 0;
      }
      if (!isNew) {
        post = await api.get<Detail>(
          `/${collection}/${encodeURIComponent(slug)}`,
        );
        const d =
          collection === "spec"
            ? { ...post.extraFields, ...post.data }
            : post.data;
        title = String(d.title ?? post.extraFields.title ?? "");
        published = String(d.published ?? today());
        updated = String(d.updated ?? "");
        description = String(d.description ?? "");
        category = String(d.category ?? "");
        tags = Array.isArray(d.tags) ? d.tags.join(", ") : "";
        series = String(d.series ?? "");
        seriesOrder =
          typeof d.seriesOrder === "number" ? d.seriesOrder : undefined;
        draft = Boolean(d.draft);
        pinned = Boolean(d.pinned);
        password = String(d.password ?? "");
        passwordProtected = password.length > 0;
        passwordHint = String(d.passwordHint ?? "");
        image = String(d.image ?? "");
        author = String(d.author ?? "");
        lang = String(d.lang ?? "");
        sourceLink = String(d.sourceLink ?? "");
        licenseName = String(d.licenseName ?? "");
        licenseUrl = String(d.licenseUrl ?? "");
        comment = d.comment !== false;
        locationName = String(d.location ?? "");
        status = String(d.status ?? "");
        order = typeof d.order === "number" ? d.order : undefined;
        memberLinks = Array.isArray(d.link)
          ? (d.link as typeof memberLinks).map((l) => ({
              ...l,
              icon: l.icon === "github" ? "fa7-brands:github" : l.icon,
            }))
          : [];
        body = post.body;
        extraJson = JSON.stringify({ ...post.extraFields, ...d }, null, 2);
        await refreshImages();
      }
      // Wait for Svelte's reactive snapshot before enabling change tracking.
      await tick();
      snapshot = state;
      ready = true;
    } catch (e) {
      error = messageOf(e);
    } finally {
      loading = false;
    }
  }
  async function refreshImages() {
    if (!post) return;
    const r = await api.get<{ images: typeof images }>(
      `/${collection}/${encodeURIComponent(post.slug)}/images`,
    );
    images = r.images;
  }
  async function save(publish = false) {
    if (saving || uploading) return;
    error = "";
    message = "";
    saving = true;
    try {
      if (collection !== "spec" && !published)
        throw new Error("请填写发布日期");
      if (collection !== "dynamic" && collection !== "spec" && !title.trim())
        throw new Error("请填写标题");
      if (collection === "posts" && passwordProtected && !password.trim())
        throw new Error("启用密码保护后，请填写文章访问密码");
      const payload = data();
      if (isNew) {
        let target = filename.trim();
        if (collection !== "dynamic" && !target)
          throw new Error("请填写文件标识");
        if (target && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target))
          throw new Error("文件标识仅支持小写字母、数字和短横线");
        const r = await api.post<{ slug: string }>(`/${collection}`, {
          ...(target ? { slug: target } : {}),
          data: payload,
          body,
          commit: true,
        });
        snapshot = state;
        setUnsavedChanges(false);
        contentSaved();
        navigate(`/${collection}/${encodeURIComponent(r.slug)}`);
        return;
      }
      if (!post) return;
      const r = await api.put<{
        version: Detail["version"];
        committed: boolean;
      }>(`/${collection}/${encodeURIComponent(slug)}`, {
        data: payload,
        body,
        expected: post.version,
        commit: true,
      });
      post.version = r.version;
      snapshot = state;
      setUnsavedChanges(false);
      message = r.committed
        ? "已保存到仓库，前往发布中心推送后生效。"
        : "已保存，内容没有变化。";
      contentSaved();
      if (publish) {
        const result = await api.post<{ pushedCount: number }>("/publish", {});
        message = `已推送 ${result.pushedCount} 个提交，等待博客自动构建。`;
        contentSaved();
      }
    } catch (e) {
      error =
        e instanceof ApiClientError && e.status === 409
          ? "内容或仓库已有更新。请先复制当前正文备份，再重新加载后合并修改。"
          : messageOf(e);
    } finally {
      saving = false;
    }
  }
  async function uploadImage(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files?.length || !post) return;
    uploading = true;
    error = "";
    try {
      for (const file of Array.from(input.files)) {
        if (file.size > 5 * 1024 * 1024)
          throw new Error(`${file.name} 超过 5MB`);
        const form = new FormData();
        form.append("file", file);
        const r = await api.upload<{ refPath: string }>(
          `/${collection}/${encodeURIComponent(slug)}/images`,
          form,
        );
        body += `\n![${file.name.replace(/[\[\]]/g, "")}](${r.refPath})\n`;
      }
      await refreshImages();
      message = "图片已上传并插入正文，请保存以提交图片和文章。";
      contentSaved();
    } catch (e) {
      error = messageOf(e);
    } finally {
      uploading = false;
      input.value = "";
    }
  }
  async function remove() {
    if (!post || deleteText !== slug || saving) return;
    saving = true;
    error = "";
    try {
      await api.del(`/${collection}/${encodeURIComponent(slug)}`, {
        expected: post.version,
      });
      setUnsavedChanges(false);
      contentSaved();
      navigate(`/${collection}`);
    } catch (e) {
      error = messageOf(e);
    } finally {
      saving = false;
    }
  }
  function download() {
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug === "new" ? "draft" : slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function beforeUnload(e: BeforeUnloadEvent) {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
  function shortcut(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void save();
    }
  }
  onMount(() => {
    void load();
    if (collection === "posts")
      void Promise.all([
        api.get<typeof meta>("/meta"),
        api.get<{ items: typeof seriesList }>("/series"),
      ])
        .then(([m, s]) => {
          meta = m;
          seriesList = s.items;
        })
        .catch((e) => (error = messageOf(e)));
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", shortcut);
      setUnsavedChanges(false);
    };
  });
</script>

<div class="page-heading editor-heading">
  <div>
    <div class="eyebrow">CONTENT / {collection.toUpperCase()}</div>
    <h1>{isNew ? "新建" : "编辑"}{collections[collection].singular}</h1>
    <a class="muted" href={`#/${collection}`}
      >← 返回{collections[collection].label}</a
    >
  </div>
  <div class="action-row">
    <span class="save-state">{dirty ? "● 有未保存修改" : "✓ 内容已保存"}</span
    ><button on:click={download}>导出正文</button><button
      class="primary"
      disabled={saving || uploading || loading}
      on:click={() => save()}>{saving ? "保存中…" : "保存内容"}</button
    >{#if !isNew}<button
        disabled={saving || uploading || loading}
        on:click={() => save(true)}>保存并推送</button
      >{/if}
  </div>
</div>
{#if error}<div class="err" role="alert">
    {error}{#if !post && !isNew}<button on:click={load}>重新加载</button>{/if}
  </div>{/if}{#if message}<div class="msg" role="status">{message}</div>{/if}
{#if loading}<div class="empty">正在载入编辑器…</div>{:else if post || isNew}
  <div class="editor-layout" class:member-layout={collection === "projects"}>
    <section class="panel content-editor">
      <div class="editor-top">
        <span
          >{post?.editorMode === "plaintext"
            ? "MDX 源码"
            : "Markdown 正文"}</span
        >
        <div class="view-tabs">
          <button
            class:chosen={!showPreview}
            on:click={() => (showPreview = false)}>编辑</button
          ><button
            class:chosen={showPreview}
            on:click={() => (showPreview = true)}>预览</button
          >
        </div>
      </div>
      <AiEditor
        {body}
        {title}
        {description}
        {tags}
        {collection}
        on:apply={(e) => applySuggestion(e.detail)}
      />
      <TemplatePicker
        {collection}
        {title}
        {body}
        on:apply={(e) => applySuggestion(e.detail)}
      />
      <div class="markdown-tools">
        <button on:click={() => insert("**", "**")} disabled={showPreview}
          >粗体</button
        ><button on:click={() => insert("\n## ")} disabled={showPreview}
          >标题</button
        ><button on:click={() => insert("\n- ")} disabled={showPreview}
          >列表</button
        ><button
          on:click={() => insert("\n```text\n", "\n```\n")}
          disabled={showPreview}>代码</button
        ><button
          on:click={() => insert("[", "](https://)")}
          disabled={showPreview}>链接</button
        ><button on:click={undoSuggestion} disabled={!undoStack.length}
          >撤销 AI / 模板</button
        >
      </div>
      {#if post?.editorMode === "plaintext"}<p class="hint mdx-note">
          MDX 预览仅展示 Markdown；组件效果以博客构建为准。
        </p>{/if}
      {#if showPreview}<iframe
          class="preview"
          title="Markdown 预览（隔离环境）"
          sandbox=""
          srcdoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: http://127.0.0.1:* data:; style-src 'unsafe-inline'"><style>.markdown-tools{display:flex;flex-wrap:wrap;gap:7px;padding:10px 15px;border-bottom:1px solid #edf0f7}.markdown-tools button{font-size:10px;padding:5px 9px}.editor-layout.member-layout{grid-template-columns:minmax(0,1fr) 410px}@media(max-width:1150px){.editor-layout.member-layout{grid-template-columns:1fr}.member-layout .settings{order:-1}}
body{font:14px/1.9 system-ui;color:#334155;padding:20px;overflow-wrap:anywhere}img{max-width:100%}pre{background:#f4f6fb;padding:16px;overflow:auto;border-radius:8px}code{font-size:12px}blockquote{border-left:3px solid #bdc6ef;padding-left:15px;color:#7b88a2}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}a{color:#5366df}</style></head><body>${previewHtml}</body></html>`}
        ></iframe>
      {:else}<textarea
          bind:this={bodyArea}
          class="markdown-editor"
          aria-label="Markdown 正文"
          bind:value={body}
          placeholder="在这里记录你的探索…"
          spellcheck="false"
        ></textarea>{/if}
      <div class="editor-footer">
        <span
          >{body.length.toLocaleString()} 字符 · {body.split("\n").length} 行</span
        ><span>⌘ / Ctrl + S 保存</span>
      </div>
      {#if post}<div class="image-tools">
          <label class="button upload"
            >{uploading ? "正在上传…" : "＋ 上传图片"}<input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.avif,.gif"
              multiple
              disabled={uploading || saving}
              on:change={uploadImage}
            /></label
          ><small>PNG / JPG / WebP / AVIF / GIF，最大 5MB</small
          >{#each images as img}<button
              class="image-ref"
              title={`${img.sizeKB}KB · 点击插入正文`}
              on:click={() => (body += `\n![](${img.refPath})\n`)}
              >{img.name}</button
            ><button class="image-ref" on:click={() => (image = img.refPath)}
              >{collection === "projects" ? "设为头像" : "设为封面"}</button
            >{/each}
        </div>{/if}
    </section>
    <aside class="settings">
      <section class="panel">
        <div class="panel-head">
          <h2>内容属性</h2>
          <span class="badge neutral">{isNew ? "NEW" : slug}</span>
        </div>
        <div class="panel-body fields">
          {#if isNew}<label class="form-field"
              >文件标识{collection === "dynamic"
                ? "（留空自动生成）"
                : ""}<input
                bind:value={filename}
                placeholder="例如 cyber-club-news"
              /></label
            >{/if}
          {#if collection !== "spec"}<label class="form-field"
              >{collection === "dynamic"
                ? "动态标题（可选）"
                : collection === "projects"
                  ? "成员名称"
                  : "标题"}<input bind:value={title} /></label
            ><label class="form-field"
              >{collection === "projects" ? "资料建立日期" : "发布日期"}<input
                type="date"
                bind:value={published}
              /></label
            >{/if}
          {#if collection === "posts"}<label class="form-field"
              >更新日期<input type="date" bind:value={updated} /></label
            ><label class="form-field"
              >分类<input list="categories" bind:value={category} /><datalist
                id="categories"
                >{#each meta?.categories ?? [] as c}<option value={c.name}
                  ></option>{/each}</datalist
              ></label
            >{/if}
          {#if collection === "posts" || collection === "projects"}<label
              class="form-field"
              >摘要<textarea rows="3" bind:value={description}
              ></textarea></label
            >{#if collection === "posts"}<div class="form-field">
                <span>标签</span><TagPicker
                  bind:value={tags}
                  suggestions={meta?.tags?.map((t) => t.name) ?? []}
                />
              </div>
              <label class="form-field"
                >封面图路径<input
                  bind:value={image}
                  placeholder="图片路径或 HTTPS 地址"
                /></label
              >{/if}<label class="check-field"
              ><input
                type="checkbox"
                bind:checked={draft}
              />草稿（博客前台不显示）</label
            >{/if}
          {#if collection === "dynamic"}<label class="form-field"
              >地点<input
                list="dynamic-locations"
                bind:value={locationName}
                placeholder="选择常用地点或自定义"
              /><datalist id="dynamic-locations"
                ><option value="线上"></option><option value="社团活动室"
                ></option><option value="校内"></option><option value="校外"
                ></option></datalist
              ></label
            >{/if}
          {#if collection === "posts" || collection === "dynamic"}<label
              class="check-field"
              ><input type="checkbox" bind:checked={pinned} />置顶内容</label
            >{/if}
          {#if collection === "spec"}<label class="form-field"
              >页面名称<input
                bind:value={title}
                placeholder="用于管理识别"
              /></label
            ><label class="form-field"
              >页面摘要<textarea rows="3" bind:value={description}
              ></textarea></label
            ><label class="form-field"
              >语言<select bind:value={lang}
                ><option value="">跟随站点</option><option value="zh-CN"
                  >简体中文</option
                ><option value="en">English</option
                >{#if lang && !["zh-CN", "en"].includes(lang)}<option
                    value={lang}>{lang}</option
                  >{/if}</select
              ></label
            >
            <details>
              <summary>其他页面属性（高级）</summary><label class="form-field"
                >JSON 对象<textarea
                  rows="12"
                  bind:value={extraJson}
                  spellcheck="false"
                ></textarea></label
              >
              <p class="hint">
                会保留未修改的属性。页面正文用于关于、友链或留言页。
              </p>
            </details>
            <p class="hint">
              独立页面的前台路由由博客工程定义，新增文件不会自动新增路由。
            </p>{/if}
          {#if collection === "posts"}<label class="form-field"
              >系列<input list="series" bind:value={series} /><datalist
                id="series"
                >{#each seriesList as s}<option value={s.name}
                  ></option>{/each}</datalist
              ></label
            ><label class="form-field"
              >章节序号<input
                type="number"
                step="1"
                min="1"
                bind:value={seriesOrder}
              /></label
            >{/if}
          {#if collection === "projects"}<MemberFields
              bind:status
              bind:order
              bind:tags
              bind:image
              bind:lang
              bind:links={memberLinks}
              {slug}
              {isNew}
              on:upload={() => refreshImages()}
            />{/if}
        </div>
      </section>
      {#if collection === "posts"}<section class="panel">
          <details class="advanced">
            <summary>访问与版权设置</summary>
            <div class="fields">
              <label class="form-field">作者<input bind:value={author} /></label
              ><label class="form-field"
                >语言<input bind:value={lang} placeholder="zh-CN" /></label
              ><label class="form-field"
                >原文链接<input bind:value={sourceLink} /></label
              ><label class="form-field"
                >许可证名称<input bind:value={licenseName} /></label
              ><label class="form-field"
                >许可证链接<input bind:value={licenseUrl} /></label
              ><label class="check-field"
                ><input type="checkbox" bind:checked={comment} />允许评论</label
              >
              <label class="check-field"
                ><input
                  type="checkbox"
                  bind:checked={passwordProtected}
                />启用文章密码保护</label
              >
              <p class="hint">
                {passwordProtected
                  ? "本文需要访问密码，与管理界面登录密码独立。"
                  : "公开访问：文章无需密码，默认不启用保护。"}
              </p>
              {#if passwordProtected}
                <label class="form-field"
                  >文章访问密码<input
                    type="password"
                    name="article-access-password"
                    autocomplete="new-password"
                    bind:value={password}
                  /></label
                >
                <label class="form-field"
                  >密码提示<input
                    name="article-password-hint"
                    autocomplete="off"
                    bind:value={passwordHint}
                  /></label
                >
              {/if}
            </div>
          </details>
        </section>{/if}
      {#if post}<section class="panel">
          <div class="panel-body fields">
            <p class="hint">
              文件标识：{slug}<br />保存仅提交到仓库，推送后才触发博客构建。
            </p>
            {#if post.postUrl}<a
                class="button"
                href={`https://www.cyberpioneer.club${post.postUrl}`}
                target="_blank"
                rel="noreferrer">查看博客页面 <Icon name="arrow" size={14} /></a
              >{/if}<button
              class="danger"
              on:click={() => (showDelete = !showDelete)}
              >删除此{collections[collection].singular}</button
            >{#if showDelete}<div class="delete-confirm">
                <p>
                  将删除内容文件并创建删除提交。可通过 Git 历史恢复。输入 <strong
                    >{slug}</strong
                  > 确认。
                </p>
                <input
                  aria-label="输入文件标识确认删除"
                  bind:value={deleteText}
                /><button
                  class="danger"
                  disabled={deleteText !== slug || saving}
                  on:click={remove}>确认删除</button
                >
              </div>{/if}
          </div>
        </section>{/if}
    </aside>
  </div>{/if}

<style>
  .markdown-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    padding: 10px 15px;
    border-bottom: 1px solid #edf0f7;
  }
  .markdown-tools button {
    font-size: 10px;
    padding: 5px 9px;
  }
  .editor-layout.member-layout {
    grid-template-columns: minmax(0, 1fr) 410px;
  }
  @media (max-width: 1150px) {
    .editor-layout.member-layout {
      grid-template-columns: 1fr;
    }
    .member-layout .settings {
      order: -1;
    }
  }
  .editor-heading {
    align-items: flex-start;
  }
  .editor-heading h1 {
    font-size: 24px;
  }
  .save-state {
    font-size: 11px;
    color: #9aa5bc;
  }
  .editor-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 305px;
    gap: 24px;
    align-items: start;
  }
  .content-editor {
    position: sticky;
    top: 20px;
  }
  .editor-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 13px 20px;
    border-bottom: 1px solid #e8ecf3;
    color: #8290aa;
    font-size: 12px;
  }
  .view-tabs {
    display: flex;
    background: #f5f7fc;
    border-radius: 6px;
    padding: 3px;
  }
  .view-tabs button {
    border: 0;
    background: none;
    font-size: 11px;
    padding: 6px 13px;
  }
  .view-tabs button.chosen {
    background: white;
    color: #5366df;
    box-shadow: 0 1px 4px #13234a10;
  }
  .markdown-editor {
    display: block;
    width: 100%;
    min-height: 65vh;
    border: 0;
    border-radius: 0;
    resize: vertical;
    padding: 24px;
    line-height: 1.9;
    font-size: 13px;
    font-family: "SFMono-Regular", Consolas, "PingFang SC", monospace;
    tab-size: 2;
    color: #52617b;
  }
  .markdown-editor:focus {
    outline: 0;
  }
  .editor-footer {
    display: flex;
    justify-content: space-between;
    padding: 13px 20px;
    border-top: 1px solid #eff2f7;
    font-size: 10px;
    color: #a1adc2;
  }
  .preview {
    border: 0;
    width: 100%;
    min-height: 65vh;
    display: block;
    background: white;
  }
  .settings {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .settings .panel-head {
    padding: 18px;
  }
  .settings .panel-head .badge {
    max-width: 135px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }
  .settings .panel-body {
    padding: 18px;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 17px;
  }
  .advanced {
    padding: 20px;
  }
  .advanced summary {
    font-size: 12px;
    color: #75839d;
    cursor: pointer;
  }
  .advanced .fields {
    margin-top: 22px;
  }
  .image-tools {
    display: flex;
    gap: 9px;
    align-items: center;
    flex-wrap: wrap;
    border-top: 1px solid #eff2f7;
    padding: 15px;
  }
  .image-tools small {
    font-size: 10px;
    color: #a1adc2;
  }
  .upload {
    font-size: 11px;
    cursor: pointer;
    padding: 8px 12px;
  }
  .upload input {
    display: none;
  }
  .image-ref {
    font-size: 10px;
    padding: 5px 8px;
  }
  .mdx-note {
    padding: 12px 20px;
    margin: 0;
  }
  .delete-confirm p {
    font-size: 11px;
    line-height: 1.8;
    color: #9b7781;
  }
  .delete-confirm input {
    width: 100%;
    margin-bottom: 10px;
  }
  .delete-confirm button {
    width: 100%;
  }
  @media (max-width: 1200px) {
    .editor-layout {
      grid-template-columns: minmax(0, 1fr) 270px;
      gap: 16px;
    }
    .editor-heading {
      flex-wrap: wrap;
    }
  }
  @media (max-width: 950px) {
    .editor-layout {
      grid-template-columns: 1fr;
    }
    .content-editor {
      position: static;
    }
    .markdown-editor,
    .preview {
      min-height: 50vh;
    }
    .settings {
      display: grid;
      grid-template-columns: 1fr;
    }
    .editor-heading .action-row {
      gap: 7px;
    }
    .editor-heading button {
      font-size: 11px;
      padding: 8px 11px;
    }
  }
</style>
