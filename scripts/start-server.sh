#!/bin/bash
# 启动 CMS API 服务（守护进程方式，日志到 /tmp/cms-server.log）
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export CMS_REPO_PATH="$DIR/test-fixtures/blog"
export CMS_ADMIN_PASSWORD="admin123"
export PORT=8787
export HOST=127.0.0.1
cd "$DIR/server"
nohup ./node_modules/.bin/tsx src/index.ts > /tmp/cms-server.log 2>&1 &
echo "server-pid=$!"
