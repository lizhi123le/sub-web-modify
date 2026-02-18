#!/bin/sh
set -e

# 替换 nginx 配置中的后端地址占位符
BACKEND_URL=${BACKEND_API_URL:-https://url.v1.mk}
sed -i "s|BACKEND_PLACEHOLDER|$BACKEND_URL|g" /etc/nginx/conf.d/default.conf.template

# 复制最终配置
cp /etc/nginx/conf.d/default.conf.template /etc/nginx/conf.d/default.conf

# 执行传入的命令
exec "$@"
