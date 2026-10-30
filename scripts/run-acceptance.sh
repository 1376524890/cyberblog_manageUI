#!/bin/bash
# 一键验收（自包含环境）：进程内启动 API + 全链路验收
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"

export CMS_REPO_PATH="$DIR/test-fixtures/blog"
export CMS_ADMIN_PASSWORD="admin123"
export PORT=8787
export HOST=127.0.0.1

cd "$DIR/server"
exec ./node_modules/.bin/tsx "$DIR/scripts/acceptance.mjs"
