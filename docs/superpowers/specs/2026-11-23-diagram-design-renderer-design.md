# diagram-design 规范移植设计

## 背景

`cathrynlavery/diagram-design@ff6fffa` 是 MIT 授权的 Agent Skill，核心资产是 51 类图表的设计规范和自包含 HTML 示例；它不是服务器可调用的渲染库。现有 GitHub 日报链路由模型输出结构化 `Architecture` JSON，`server/src/ai/architecture.ts` 使用 sharp 确定性渲染 1800px 宽 PNG。直接把 Agent HTML 生成/浏览器截图引入生产会增加模型不确定性、浏览器依赖和截图失败面，不适合无人值守日报。

## 目标

把 Architecture 类型的 diagram-design 视觉规范移植到现有确定性渲染器：

- 保留模型 JSON 契约、审稿、验证、日报缓存和文章资产链路。
- 输出符合上游 `doc-inline` 预设：960×600 逻辑画布，sharp 以 2x 导出 1920×1200 PNG。
- 使用上游默认皮肤语义：暖纸底、墨色主体、单一珊瑚焦点、无阴影。
- 按 entry/core/support 分层；主流程正交连线，标签带纸色遮罩；核心层包含焦点处理。
- 中文使用现有 Noto CJK 字体和 `CMS_DIAGRAM_FONT` 缓存机制。
- 图表超出复杂度预算时确定性扩展高度，宽度仍 1920；继续满足内容 API PNG ≤2400×3200 的限制。

## 非目标

- 不引入浏览器、Playwright或上游 Agent 提示词运行时。
- 不改变文章 API、资产命名、Markdown 嵌入和 Git 写入协议。
- 不生成 HTML 附件；日报仍只提交 PNG。

## 设计

### 数据契约

`Architecture` 继续包含 `diagramTitle`、1–9 个节点和有据连线。节点层仍为 `entry|core|support`。渲染函数签名保持 `renderArchitecturePNG(repo: string, a: Architecture)`，调用方无需改动。

### 画布与布局

逻辑画布宽 960。顶部 88px 为标题、仓库和 `GITHUB DAILY` 眉标。下方从上到下依次是 entry、core、support 三个层区。每层区使用 4px 网格、纸色标签遮罩和细边框。同层最多三列，超过三列换行；不同层高由节点数决定，画布高度从 600 起按内容扩展。节点统一 248×124，圆角 8；entry 使用浅墨填充，support 使用轻纸灰，core 中首个节点使用焦点底色和焦点描边，其余 core 节点使用白底墨边。

### 连线

连接在节点之前绘制。非同行连接从源节点底部/侧边出发，以 8px 圆角两折正交路径进入目标节点顶部/侧边；同行相邻节点使用水平线。标签放置在折线竖段或水平中点，带纸色背景遮罩。箭头为墨色细三角。连线不经过文本遮罩下方，绘制顺序保证节点覆盖多余线段。

### 排版

标题 28px，节点名 14px/600，描述 11px，路径和技术标签 10px，层眉标 8px 大写。文本仍使用 sharp 文本层渲染，按可用高度收缩到最低 12px；低于 12px 仍溢出时抛出 `DIAGRAM_TEXT_OVERFLOW`。所有颜色对比遵循上游 4.5:1 文本目标，焦点色使用 `#bf4520`。

### 导出

sharp 先构造 SVG 几何，再合成透明文本 PNG，最终 `density=192` 输出 1920 宽 PNG。若内容高度大于 600，逻辑高度按 4px 向上取整，输出高度等比 2x。PNG 体积与尺寸继续满足 `content-store` 约束。

## 测试

1. 失败测试先验证新渲染契约：PNG 尺寸应为 1920×1200，最小画布测试样本不应依赖旧 1800px 输出。
2. 增加结构化 SVG 断言：导出内部 `buildArchitectureSVG`，验证 960 逻辑宽、4px 网格、三层分区、正交连线、焦点节点唯一和无阴影滤镜。
3. 扩展节点测试：9 节点三行布局应产生高度 >600 的逻辑画布，2x PNG 高度同步扩展，且不超过 API 限制。
4. 保留 `scripts/test-daily.mjs` 全量回归，确认日报仍生成五张 PNG 并随文章提交。
5. 执行 `pnpm build`、`scripts/test-daily.mjs`、`scripts/test-daily-provider.mjs`、`scripts/test-research-policy.mjs`。

## 回滚

开发按既有分支规范提交；部署前保存源码、构建产物和原版本号到 `/root/cyberblog-cms-backups/`。若生产验证失败，停止 `cyber-cms.service`，恢复备份源码与 `web/dist` 后重启服务；运行数据和内容仓库不参与回滚。
