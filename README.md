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

## 内容工作台（2026-10-30）

- 工作台：文章、草稿、系列及待推送提交概览。
- 文章：标题/摘要/文件标识搜索，分类、系列、标签与草稿筛选，日期/标题排序。
- 动态、成员与独立页面：新增、编辑、删除；成员支持社交链接数组，独立页面支持属性 JSON。
- 编辑：Markdown 隔离预览、正文导出、快捷键保存、未保存提醒；文章支持封面、访问密码、版权与评论设置。
- 系列：查看章节、继续写下一篇，自动建议章节序号和文件标识。
- 图片：5MB 限制、唯一文件名、受认证保护的预览，随文章保存一起提交。
- 发布：显示真实 Git 状态与待推送记录；工作区不干净时阻止发布。推送成功不等于托管平台构建完成。

### 验证

```bash
pnpm typecheck
pnpm build
server/node_modules/.bin/tsx scripts/test-yaml.mjs
pnpm fixtures
pnpm acceptance
CMS_REPO_PATH="$PWD/test-fixtures/blog" PORT=18789 HOST=127.0.0.1 server/node_modules/.bin/tsx scripts/regression.mjs
```

回归脚本仅接受 `test-fixtures/` 下的仓库，覆盖密码与可选字段清空、多行摘要、图片上传/预览/提交/发布、动态/成员/页面写入、MDX 重名与毫秒级并发修改等问题。验收和回归请使用独立测试端口及测试仓库。

### 服务器开发与部署

当前服务器开发目录：`/root/cyberblog-cms-work`；生产应用：`/root/cyberblog-cms-prod/app`；服务：`cyber-cms.service`。内容仓库由生产环境配置指定，应用部署不包含内容仓库及凭据文件。

构建及依赖均在服务器操作。本地仅同步源码。发布前保存应用源码、构建产物及原版本号到 `/root/cyberblog-cms-backups/`。回退时停止服务，用对应备份恢复应用源码与 `web/dist` 后启动服务；保留现有依赖、环境配置及博客内容仓库。

## AI 工作台与细化管理

本轮增加成员交互设置、九类 Markdown 模板、AI 编辑助手、对话操作卡片与 AI 设置。首次使用在「AI 设置」填写模型服务信息；密钥安全保存在服务器 `server/.env`，默认关闭 AI，源码不附带真实密钥。详细使用、配置、操作边界和验证方式见 [AI 工作台文档](docs/ai-studio.md)。

AI 设置现支持自动模型 ID 获取、分阶段连接诊断、每日/月度 token 额度；「Token 用量」可查看趋势、模型分组和调用明细。监控数据从此功能上线后开始记录，未返回 usage 的请求会标记为未上报。
