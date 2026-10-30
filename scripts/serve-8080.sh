#!/bin/bash
# CMS 测试服务：8080 公网端口（测试期，强密码）
cd /root/cms-test/server
export CMS_REPO_PATH=/root/cms-test/test-fixtures/blog
export CMS_ADMIN_PASSWORD_FILE=/root/cms-test/.admin-pass
export PORT=8080
export HOST=0.0.0.0
export NODE_OPTIONS="--max-old-space-size=768"
pkill -f "tsx src/index.ts" 2>/dev/null
sleep 1
setsid nohup ./node_modules/.bin/tsx src/index.ts > /tmp/cms-server.log 2>&1 < /dev/null &
sleep 1
echo "started"
