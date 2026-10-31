# 服务器存储保留策略

生产正式内容位于 `/root/cyberblog-cms-prod/repo`，不属于自动清理范围。清理脚本仅处理生成目录和明确标记为 `cyber-cms-generated-v1` 的测试/部署产物，默认只预览，`--apply` 才执行。

- 研究缓存保留30天，非活动缓存总量最多512MB；保留今天、昨天与运行中任务目录。空闲少于4GB或磁盘占用达到80%时缩为7天、256MB。
- 源码回退备份保留至少最新5份，超过14天或超出512MB才清理多余备份；空间紧张时至少保留3份。
- 明确标记的临时构建、QA与旧测试目录保留14天，空间紧张时3天。正在被进程作为工作目录使用的目标跳过；不跟随目录符号链接。
- 仅清理 `/tmp/cms-*.log` 中超过14天的项目诊断日志。CMS和维护任务使用独立journald命名空间 `cyberblog`，日志上限128MB，最多14天，预留系统空闲2GB。
- 正式博客、源图片、Git历史、`.env`、`cms.env`、当前运行状态、`featured-projects.json`、中文字体、Token账目及AI操作账目不清理。
- 内容、图片与日报研究开始前检查实际可用磁盘空间，默认保留1GB，并额外预留本次写入的空间；不足返回 `507 DISK_SPACE_LOW`，日报停止生成并显示原因。`CMS_MIN_FREE_MB` 可调整，最低64MB。

`cyber-cms-storage.timer` 每小时检查，另在北京时间04:30及开机约10分钟执行；主CMS和浏览器退出不影响清理。文件锁避免重复执行。结果原子保存到 `server/.runtime/storage-maintenance.json`，GitHub日报页面显示最近检查、占用和异常。

部署代码后，在服务器执行：

```bash
bash /root/cyberblog-cms-prod/app/scripts/install-storage-maintenance.sh
systemctl list-timers cyber-cms-storage.timer
journalctl --namespace=cyberblog -u cyber-cms-storage -u cyber-cms
python3 /root/cyberblog-cms-prod/app/scripts/storage-maintenance.py
```

最后一条是只读预览。首次安装仅给本项目已有部署备份与已知生成测试目录添加清理标记，并保留原目录时间；未来新增部署备份应放在同一备份根目录，创建 `.cms-disposable` 文件且内容为 `cyber-cms-generated-v1`。没有标记的备份与测试目录保留。写入保护不会删除内容来腾出空间，人工新增的大文件仍需按用途处理。

验证：`python3 scripts/test-storage-maintenance.py` 和 `server/node_modules/.bin/tsx scripts/test-storage.mjs`，测试使用隔离临时目录，覆盖干跑、活动任务、保留底线、目录符号链接、压力清理和损坏状态的保守处理。
