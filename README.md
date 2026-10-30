# CyberBlog Manage — 博客内容管理 WebUI

对 [cyberpioneer_blog](https://github.com/1376524890/cyberpioneer_blog)（Astro 7 / Firefly）仓库的 Markdown 内容进行图形化管理：按仓库既有规范创建系列与文章、可视化编辑 front matter 与正文、保存后自动 git commit + push 触发 Cloudflare Pages 发布。

> **仓库隔离红线**：本仓库与博客仓库完全独立。本仓库的任何构建产物、依赖、生成文件**严禁**出现在博客仓库中；CMS 对博客内容的写入仅发生在其被授权的仓库 clone（由 `CMS_REPO_PATH` 指定）内。设计文档见博客仓库 `docs/cms-webui-design.md` / `docs/cms-webui-api.md`。

## 结构

```
server/   Hono + zod + gray-matter + simple-git 的 API 服务（/api/v1）
web/      Svelte 5 + Vite + CodeMirror 6 前端 SPA（仅通过 API 契约通信）
scripts/  测试夹具生成 + 端到端验收
```

## 快速开始

```bash
pnpm install:all
pnpm fixtures                      # 生成 test-fixtures/ 测试仓库（含本地 bare 远端）
CMS_REPO_PATH=$(pwd)/test-fixtures/blog pnpm dev:server   # 127.0.0.1:8787
pnpm dev:web                       # 127.0.0.1:5173（代理 /api → 8787）
```

## 验收

```bash
pnpm build && pnpm acceptance
```

`scripts/acceptance.mjs` 会以测试夹具仓库为对象，覆盖：登录 → slug 预览 → 创建文章（含 409 冲突）→ 乐观锁更新 → 图片上传 → git 状态 → 推送发布 全链路。

## 配置（环境变量）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `CMS_REPO_PATH` | 被管理的博客仓库 clone 绝对路径（**必须**指向专用 clone） | 无（必填） |
| `CMS_ADMIN_PASSWORD` | 管理员密码 | `admin123`（仅开发） |
| `CMS_SESSION_SECRET` | session 签名密钥 | 开发默认，生产必换 |
| `PORT` / `HOST` | 监听地址 | `8787` / `127.0.0.1` |
| `CMS_GIT_REMOTE` | push 目标 remote | `origin` |
| `CMS_GIT_BRANCH` | 工作分支 | `main` |

## schema 同步约定

`server/src/core/schemas.ts` 是博客仓库 `src/content.config.ts` zod 定义的**手工镜像**（两仓库物理隔离，无法直接 import）。博客仓库 schema 变更时须同步此处；`pnpm --dir server test:schema-diff` 可输出当前镜像的字段清单便于人工比对。
