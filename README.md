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


## GitHub 每日开源博客

在 `#/github-daily` 启停每天北京时间 08:00 的计划、手动生成和查看草稿。任务在服务器运行，手动与定时共用 `typed-research-resumable-png-v7` 工作流及排版器；检查五个项目、正文结构、PNG文件和引用一致性后才保存。完成后只创建草稿，不推送发布；关闭浏览器不影响。同日防止重复创建，跨日按仓库身份去重，失败间隔至少 10 分钟自动重试两次，服务恢复后补跑当天遗漏任务。

专用写作配置 `DAILY_WRITING_BRIEF` 位于 `server/src/ai/daily.ts`，要求把每个项目写成 6–8 个详细、自然的博客段落，介绍用途、实际场景、使用方法与核心实现。不把采集过程、样本说明或审计免责声明写进文章。DeepSeek Flash / v4-pro 的日报调用关闭默认扩展思考，避免正文额度被耗尽；普通对话参数保持原样。正文只围绕项目展开，开篇与收尾另由模型统一撰写。模型用量（包括格式修正）沿用 AI 设置与预算，并记入“GitHub 日报”。

从 GitHub Trending daily 候选中按原排名选择五个未介绍项目；公开 REST API 获取固定提交的 README、清单和 5 份关键源码，重跑可从旧快照补读模块并缓存。模型绘图需要其他已知模块时，读取固定提交的 GitHub 官方源码页，再让模型结合新代码完善正文和结构图；最多补读两轮，不执行网页或仓库代码。内部快照和执行信息放在 `.env` 同目录 `.runtime/github-daily/`，不混入正文。源码不会被执行。公开 API 限流会在任务页显示。

架构图使用自主实现的分层卡片、模块职责和正交连线布局，参考 Archify 的图形表达，直接由 sharp 导出 1800 像素宽的 PNG。图中中文使用开源 Noto CJK 字体，首次从 Noto 官方 GitHub 仓库下载并缓存在 runtime/fonts，也可用 `CMS_DIAGRAM_FONT` 指定已有字体。项目使用简短标题、亮点引文和紧凑信息行，PNG 紧跟实现讲解，以普通 Markdown 图片插入正文，博客无需 Mermaid 或外部图片服务。

文章创建 API 支持可选 `assets:[{name,data}]`，仅允许最多 5 张有尺寸和体积限制的 PNG，拒绝路径穿越、重复名称、无效图片及覆盖既有图片目录。图片与文章在原串行写入链路中保存，同一次 Git 提交包含 Markdown 和全部图片。日报仍通过受限的 Agent propose/create 和 apply 保存，不能改动已有文章、设置密码或发布内容。

开发验证：使用独立 `test-fixtures`，运行 `scripts/test-daily.mjs`、`scripts/test-daily-provider.mjs`，前者需要通过 `CMS_DIAGRAM_FONT` 指定已有中文字体。测试任务设置 `CMS_DAILY_SCHEDULER=off`。状态与素材快照应随服务器备份保留。


选题去重会扫描已有草稿与已发布文章的 `githubRepos` 字段，并兼容旧日报中的 GitHub 链接。成功保存后把仓库名、GitHub 数字 ID、文章标识写入 `.runtime/github-daily/featured-projects.json`；删除旧稿或服务重启也不会重新推荐。仓库名统一大小写与 `.git` 后缀，数字 ID 用于识别更名。部署时应初始化已有内容记录，并将该文件随运行数据备份。失败的生成不占用项目，日榜不足五个新项目时停止本次写入并按原重试策略等待，不重复凑数。缓存同时核对仓库身份与固定提交，避免排名变化后误用旧内容。

核心质量流程先由模型规划4–7份关键实现并补读，再撰写每个项目的正文与模块关系，独立调用模型检查主流程、具体信息、源码依据和博客语气；最多按审稿意见重写一次。图文完整性和审稿均通过后才进入保存链路。`scripts/test-daily-live.mjs` 可在独立输出目录模拟08:00入口，使用真实模型验证流程但不写生产内容。


研究流程按普通软件、技能知识与文档内容选择真实功能文件；普通软件排除内部 `.agents/.claude/.cursor` 开发规则。README、包配置可以作为 support 节点，测试与开发规则不能代替核心业务，核心模块必须出现且连通。失败仍保存已规划与已读源码，重试会复用通过校验的项目结果；无效缓存重新生成。错误记录带项目、阶段和错误码。更新工作流版本后，旧版本失败任务会得到新版本的有限重试机会；同版本仍保持每日至多三次自动尝试与十分钟间隔。`scripts/test-research-policy.mjs` 覆盖不同仓库类型和 API 请求数，日报回归覆盖无人操作的升级恢复。

大型仓库保留官方返回的完整可读目录，不再按字母截掉后部模块；规划候选按包/服务平衡至700项，正文模型仅收到核心已读文件和最多120项额外候选。规划失败会保留实际返回与具体路径反馈，便于自动修正和排查。
