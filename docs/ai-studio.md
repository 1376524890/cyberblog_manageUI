# AI 内容工作台

## 使用

1. 打开「AI 设置」，填写 OpenAI 兼容 API 的基础地址、模型名称与密钥。
2. 选择接口兼容模式，启用 AI 并保存。密钥留空保留原值；勾选删除密钥时须先关闭 AI。
3. 测试已保存的配置。模型列表接口是可选能力，不支持时可手动填写模型 ID。
4. 编辑器可整理排版、润色、续写、生成提纲/正文、提炼标题摘要与标签。建议先预览，应用后仍需保存。
5. AI 工作台可查询四类内容并生成操作卡片。核对字段和正文后点击确认，或输入「确认执行 1」「确认执行全部」。

AI 请求通过服务器转发，浏览器不直接访问模型服务。API 请求参考 [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。原生工具模式使用 `tools`；JSON 模式通过结构化消息完成同一套受校验的操作。

## 交互设置与模板

- 成员：名称、简介、建立日期、草稿、状态、社内角色、排序、语言、技能标签、头像及可增删/排序的社交链接。角色与技能存入现有 tags，不引入博客不识别的新字段。
- 排序数值越大越靠前，与博客 getSortedProjects 一致。
- 社交图标使用博客已安装的 fa7 等图标集合，链接拒绝 javascript 等危险协议。
- 文章：交互标签、分类/系列选项、正文模板与 Markdown 工具栏。
- 动态：地点选项、置顶与图片管理、快讯/回顾模板。
- 独立页面：名称、摘要、语言与高级属性；about/friends/guestbook 映射到现有路由。新增 spec 文件不会自动创建前台路由。
- 所有内容可上传图片；保存时将正文与该内容目录下的图片一起提交。
- 模板和 AI 应用支持最近十次撤销；编辑过程中重新加载会丢弃内存中的撤销记录。

## 配置与秘密

默认配置文件：应用的 `server/.env`。可通过服务环境变量 `CMS_AI_ENV_FILE` 指定独立绝对路径。运行时读取，无需重启。

| 键 | 作用 |
| --- | --- |
| CMS_AI_ENABLED | 是否启用 AI |
| CMS_AI_BASE_URL | API 基础地址（通常含 /v1） |
| CMS_AI_MODEL | 模型 ID |
| CMS_AI_API_KEY | 密钥，仅后端读取 |
| CMS_AI_MODE | tools 或 json |
| CMS_AI_TEMPERATURE | 数字或 auto（不发送温度参数） |
| CMS_AI_MAX_TOKENS | 单次输出上限 |
| CMS_AI_TOKEN_PARAMETER | max_tokens 或 max_completion_tokens |
| CMS_AI_TIMEOUT_SECONDS | 单次模型请求超时 |
| CMS_AI_SYSTEM_PROMPT | 写作偏好，使用 Base64 保留多行内容；建议通过管理页编辑 |

.env 采用临时文件加 rename 原子保存，权限 0600。设置接口只返回 hasKey，不回显密钥。不将密钥写入提示词、客户端持久存储、错误正文或 Git。接口地址禁止 URL 内嵌认证信息；远程请求要求 HTTPS，localhost 模型可使用 HTTP。禁止携带 Authorization 跨重定向。

生产部署与备份应排除 `.env`、`.env.*`、`.runtime/`、node_modules、测试仓库。源码同步不包含配置文件。不要把实际密钥放入本文件、提交说明、测试快照或截图。

## 操作层

AI 可调用 list_content、get_content、get_site_status、get_templates、propose_change。工具只能访问四个允许的内容集合，不能执行 shell、任意文件写入、认证设置或密钥修改。

所有写操作均生成服务器持有的随机编号预览，15 分钟有效。确认接口接受编号，不接受客户端覆盖操作参数。执行复用原 CRUD/发布接口的认证、校验与 Git 队列。检测目标内容指纹以阻止覆盖期间的其他编辑；重复确认已完成操作返回原结果，不重复提交。发布前验证仓库 HEAD，变化时要求重新核对。

操作预览和对话记录仅存于服务/标签页内存，重启或刷新会丢失待确认卡片。执行结果记录在配置文件旁的 `.runtime/ai-actions.jsonl`，仅记录操作类型、目标标识、时间及结果，不记录密钥或完整正文。没有后台自动执行或模型自行发布。

并发模型请求最多 2 个，每分钟最多 20 个会话/编辑请求；单轮最多 6 个提案和 16 个工具步骤。SSE 提供处理进度与心跳，不要求服务商支持流式 token 输出。

## 验证

在服务器开发副本中运行，严禁用生产内容仓库跑写入测试：

```bash
pnpm typecheck
pnpm build
pnpm fixtures
CMS_REPO_PATH="$PWD/test-fixtures/blog" PORT=18787 HOST=127.0.0.1 server/node_modules/.bin/tsx scripts/acceptance.mjs
CMS_REPO_PATH="$PWD/test-fixtures/blog" PORT=18789 HOST=127.0.0.1 server/node_modules/.bin/tsx scripts/regression.mjs
CMS_REPO_PATH="$PWD/test-fixtures/blog" CMS_AI_ENV_FILE="$PWD/test-fixtures/ai/.env" PORT=18790 HOST=127.0.0.1 server/node_modules/.bin/tsx scripts/test-ai.mjs
```

AI 集成测试使用本机模拟接口，不需要真实密钥。覆盖两种调用模式、配置脱敏、字段/正文建议、头像提交、操作确认、幂等、冲突、创建删除和测试仓库推送。真实服务的可用性与模型工具能力须在填写实际配置后点击测试连接验证。

## 用量监控、模型发现与诊断（2026-10-30）

- 「Token 用量」提供今日/本月统计、7/30/90 天趋势、按模型筛选、成功率、耗时与最近 50 次请求 CSV 导出。页面可每 15 秒自动刷新。
- 每次模型请求记录输入、输出、总量及服务商提供的缓存/推理细分值；一轮对话中的所有工具循环请求分别记录，并在对话结果里累计展示。连接测试也计入用量。
- 接口不返回 usage 时标为「未上报」，不猜测 token 数。缓存/推理是细分项，不重复加到总量。数据仅涵盖此 CMS 从功能上线后发起的请求，不是账户总账单，不回补此前历史用量。
- 记录保存在配置文件旁的 `.runtime/ai-usage-YYYY-MM.jsonl`，权限 0600，不包含密钥、提示词或正文；不进入 Git。
- 设置支持每日/月度额度、预警比例以及达到额度后阻止后续请求。0 表示不限额。额度依据已上报数值，进行中请求及未上报用量可能超出，不等同于服务商硬限额。额度跨模型累计，模型筛选不改变额度计算。
- 新增环境变量：`CMS_AI_DAILY_TOKEN_LIMIT`、`CMS_AI_MONTHLY_TOKEN_LIMIT`、`CMS_AI_USAGE_WARN_PERCENT`、`CMS_AI_ENFORCE_BUDGET`。旧配置默认不限制，旧客户端保存时保留现有额度配置。
- 设置页在已有凭据时自动读取模型 ID，并支持搜索选择、手动刷新和自定义 ID。列表缓存 10 分钟；手动刷新绕过缓存。未保存的连接也可获取模型，但不会因此持久化密钥。
- 连接地址变化时，必须重新输入对应服务的密钥，不把已保存密钥自动转发到新地址。
- 「运行连通性测试」检查配置、模型列表与认证、实际生成，并可附加工具调用测试；显示耗时、失败代码和测试 token 用量。列表接口不支持时仍可测试实际生成。
- `/ai/usage`、`/ai/diagnostics` 均受管理员认证保护。最近一次诊断保存在 `.runtime/ai-diagnostics.json`，切换连接/模型后不沿用旧结果。测试当前表单不等于保存配置。

专项测试（与其他测试使用不同配置目录）：

```bash
CMS_REPO_PATH="$PWD/test-fixtures/blog" CMS_AI_ENV_FILE="$PWD/test-fixtures/observability/.env" PORT=18792 HOST=127.0.0.1 server/node_modules/.bin/tsx scripts/test-ai-observability.mjs
```

字段参考：[Chat Completions usage](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[模型列表](https://developers.openai.com/api/reference/resources/models/methods/list)。兼容服务可能不支持全部字段，管理界面会保留未上报状态。
