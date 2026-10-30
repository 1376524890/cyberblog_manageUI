#!/bin/bash
# 以前台方式启动 CMS API 服务（供后台任务机制运行，进程即服务本身）
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export CMS_REPO_PATH="$DIR/test-fixtures/blog"
export CMS_ADMIN_PASSWORD="admin123"
export PORT=8787
export HOST=127.0.0.1
cd "$DIR/server"
exec ./node_modules/.bin/tsx src/index.ts
