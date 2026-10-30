#!/usr/bin/env node
/**
 * 端到端验收：进程内启动 API（tsx 直接 import 后端入口，免独立进程），
 * 再按 API 契约全链路验证。
 * 前置：pnpm fixtures && bash scripts/run-acceptance.sh
 */
const BASE = "http://127.0.0.1:8787/api/v1";

// 1) 若端口未监听则进程内启动服务器；已在监听则直接复用（如独立 dev 服务）
async function portUp() {
	try {
		await fetch(`${BASE}/posts`);
		return true;
	} catch {
		return false;
	}
}
if (!(await portUp())) {
	const serverDir = new URL("../server/src/index.ts", import.meta.url).pathname;
	await import(serverDir);
}
// 2) 等待端口就绪
for (let i = 0; i < 40; i++) {
	if (await portUp()) break;
	await new Promise((r) => setTimeout(r, 250));
}

let token = "";
let passed = 0;
let failed = 0;

function check(name, cond, extra = "") {
	if (cond) {
		passed++;
		console.log(`  ✓ ${name}`);
	} else {
		failed++;
		console.error(`  ✗ ${name} ${extra}`);
	}
}

async function req(method, path, body, isForm = false) {
	const headers = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
	});
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		/* non-json */
	}
	return { status: res.status, json };
}

console.log("== 1. 认证 ==");
{
	let r = await req("GET", "/posts");
	check("未认证访问被拒（401）", r.status === 401);

	r = await req("POST", "/auth/login", { password: "wrong" });
	check("错误密码 401", r.status === 401);

	r = await req("POST", "/auth/login", { password: "admin123" });
	check("正确密码登录成功", r.status === 200 && r.json?.ok === true);
	token = r.json?.token ?? "";
	check("返回 Bearer token", typeof token === "string" && token.length > 10);
}

console.log("== 2. 列表与元数据 ==");
{
	const r = await req("GET", "/posts?page=1&pageSize=50");
	check("文章列表 200", r.status === 200);
	check("包含 4 篇文章（3 系列 + 1 单篇 + 1 草稿 = 5？）", r.json?.pagination?.total === 5,
		`实际 ${r.json?.pagination?.total}`);
	const slugs = (r.json?.items ?? []).map((i) => i.slug);
	check("._垃圾文件被过滤（无 ._ 开头条目）", slugs.every((s) => !s.startsWith("._")));

	const draftR = await req("GET", "/posts?draft=true");
	check("草稿筛选", draftR.json?.pagination?.total === 1 && draftR.json?.items?.[0]?.slug === "draft-post");

	const seriesR = await req("GET", "/posts?series=" + encodeURIComponent("C++ 入门教程"));
	check("系列筛选返回 3 篇", seriesR.json?.pagination?.total === 3);

	const catR = await req("GET", "/posts?category=" + encodeURIComponent("C++ 教程"));
	check("分类筛选返回 3 篇", catR.json?.pagination?.total === 3);
}

console.log("== 3. 单篇读取（含 extra 字段保留验证）==");
{
	const r = await req("GET", "/posts/cpp-tutorial-01");
	check("单篇读取 200", r.status === 200);
	check("schema 内字段解析", r.json?.data?.title?.includes("C++ 入门教程"));
	check("schema 外 slug 字段保留在 extraFields", r.json?.extraFields?.slug === "cpp-tutorial-01");
	check("published 日期为 YYYY-MM-DD 字符串", typeof r.json?.data?.published === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.json.data.published));
}

console.log("== 4. series 与 meta ==");
{
	const s = await req("GET", "/series");
	const cpp = s.json?.items?.find((x) => x.name === "C++ 入门教程");
	check("系列列表含 C++ 入门教程", Boolean(cpp));
	check("系列 count=3 与 orders 连续", cpp?.count === 3 && cpp?.orders?.join(",") === "1,2,3");
	check("系列 filePrefix 推断", cpp?.filePrefix === "cpp-tutorial");

	const m = await req("GET", "/meta");
	check("meta 分类聚合", m.json?.categories?.some((c) => c.name === "C++ 教程" && c.count === 3));
	check("meta 字段表（title required）", m.json?.fields?.posts?.some((f) => f.key === "title" && f.required));
}

console.log("== 5. slug 预览 ==");
{
	const r = await req("POST", "/slug-preview", { title: "重庆的SQL注入实战" });
	check("中文转拼音 slug", r.status === 200 && typeof r.json?.slug === "string" && r.json.slug.length > 0, JSON.stringify(r.json));
	check("未被占用 available=true", r.json?.available === true);

	const r2 = await req("POST", "/slug-preview", { title: "C++ 入门教程（一）：测试章节 1" });
	// slug 不同不冲突；直接用已有文件名测试冲突
	const r3 = await req("POST", "/slug-preview", { filename: "cpp-tutorial-01" });
	check("已占用 slug available=false + conflict", r3.json?.available === false && r3.json?.conflict !== null);
}

console.log("== 6. 创建文章 ==");
let newPostVersion;
{
	// 非法 slug
	let r = await req("POST", "/posts", {
		slug: "Bad Slug!!",
		data: { title: "x", published: "2026-10-29" },
		body: "",
	});
	check("非法 slug 422", r.status === 422);

	// 校验失败（缺 published）
	r = await req("POST", "/posts", {
		slug: "validation-fail-test",
		data: { title: "缺日期" },
		body: "",
		commit: false,
	});
	check("缺必填字段 422 + 字段级错误", r.status === 422 && Array.isArray(r.json?.error?.details?.issues));

	// 正常创建（commit 但不 push）
	r = await req("POST", "/posts", {
		slug: "acceptance-new-post",
		data: {
			title: "验收测试文章",
			published: "2026-10-29",
			description: "验收",
			category: "技术分享",
			tags: ["验收"],
			draft: true,
		},
		body: "# 验收\n\n由验收脚本创建。\n",
		commit: true,
	});
	check("创建文章 201", r.status === 201, JSON.stringify(r.json));
	check("已提交且待推送", r.json?.committed === true && r.json?.pendingPush === true);
	newPostVersion = r.json?.version;

	// 重复创建 → 409
	r = await req("POST", "/posts", {
		slug: "acceptance-new-post",
		data: { title: "重复", published: "2026-10-29" },
		body: "",
		commit: false,
	});
	check("重复 slug 409", r.status === 409);
}

console.log("== 7. 乐观锁更新 ==");
{
	// 错误的 expected → 409
	let r = await req("PUT", "/posts/acceptance-new-post", {
		data: { title: "并发冲突测试" },
		body: "x",
		expected: { head: "0000000000000000000000000000000000000000", fileMtimeMs: 0 },
	});
	check("乐观锁冲突 409", r.status === 409);

	// 正常更新
	r = await req("PUT", "/posts/acceptance-new-post", {
		data: { title: "验收测试文章（已更新）", draft: false },
		body: "# 验收\n\n更新后的内容。\n",
		expected: newPostVersion,
		commit: true,
	});
	check("更新成功 200", r.status === 200, JSON.stringify(r.json));
	newPostVersion = r.json?.version;

	// 验证 extra 字段仍在 + 内容落盘
	const g = await req("GET", "/posts/acceptance-new-post");
	check("更新后标题生效", g.json?.data?.title === "验收测试文章（已更新）");
	check("更新后 draft=false", g.json?.data?.draft === false);
}

console.log("== 8. dynamic 集合 ==");
{
	const r = await req("GET", "/dynamic");
	check("dynamic 列表 200", r.status === 200);
	const first = r.json?.items?.[0];
	check("dynamic title 来自 extra", first?.title === "测试动态");

	// mood（schema 外）保留验证
	const one = await req("GET", `/dynamic/${first?.slug}`);
	check("dynamic mood 字段保留", one.json?.extraFields?.mood === "🎉");
}

console.log("== 9. git 状态与发布 ==");
{
	const st = await req("GET", "/git/status");
	check("git status 200", st.status === 200);
	check("有 2 个待推送提交", st.json?.pendingPushCount === 2, `实际 ${st.json?.pendingPushCount}`);
	check("pendingCommits 含 feat(post) 提交", st.json?.pendingCommits?.some((c) => c.message.includes("feat(post)")));

	const pub = await req("POST", "/publish", {});
	check("publish 200", pub.status === 200 && pub.json?.ok === true, JSON.stringify(pub.json));
	check("推送 2 个提交", pub.json?.pushedCount === 2);

	const st2 = await req("GET", "/git/status");
	check("推送后 pendingPushCount=0", st2.json?.pendingPushCount === 0);
	check("推送后 clean=true", st2.json?.clean === true);
}

console.log("== 10. 删除与二次发布 ==");
{
	const g = await req("GET", "/posts/acceptance-new-post");
	let r = await req("DELETE", "/posts/acceptance-new-post", {
		expected: g.json?.version,
	});
	check("删除 200", r.status === 200 && r.json?.ok === true);

	const g2 = await req("GET", "/posts/acceptance-new-post");
	check("删除后 404", g2.status === 404);

	const pub = await req("POST", "/publish", {});
	check("删除提交推送成功", pub.status === 200);

	// 最终校验：远端 HEAD 与本地一致
	const st = await req("GET", "/git/status");
	check("最终状态 clean 且无待推送", st.json?.clean === true && st.json?.pendingPushCount === 0);
}

console.log("== 11. 登出与静态托管 ==");
{
	const out = await req("POST", "/auth/logout");
	check("登出 200", out.status === 200);

	const html = await fetch("http://127.0.0.1:8787/");
	check("前端 index.html 可访问", html.status === 200 && (await html.text()).includes("CyberBlog"));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
// 进程内启动的 server 会保持事件循环，显式退出
process.exit(failed > 0 ? 1 : 0);
