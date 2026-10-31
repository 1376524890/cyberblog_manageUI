// 最小冒烟：进程内启动服务 + 3 个断言，验证 in-process 方案可行性
const BASE = "http://127.0.0.1:8787/api/v1";
process.env.CMS_REPO_PATH ??= new URL("../test-fixtures/blog", import.meta.url).pathname;
await import("../server/src/index.ts");
for (let i = 0; i < 40; i++) {
	try {
		await fetch(`${BASE}/posts`);
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 250));
	}
}
const r1 = await fetch(`${BASE}/posts`);
console.log("unauth:", r1.status);
const r2 = await fetch(`${BASE}/auth/login`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ username: "cyberclubadmin", password: "admin123" }),
});
console.log("login:", r2.status);
const token = (await r2.json()).token;
const r3 = await fetch(`${BASE}/posts`, { headers: { Authorization: `Bearer ${token}` } });
const list = await r3.json();
console.log("list total:", list.pagination?.total);
process.exit(r1.status === 401 && r2.status === 200 && list.pagination?.total === 5 ? 0 : 1);
