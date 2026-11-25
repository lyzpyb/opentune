#!/usr/bin/env bash
set -euo pipefail

echo "==> 正在构建 OpenTune macOS (.dmg) 客户端..."
if ! command -v node >/dev/null 2>&1; then
  echo "错误：未检测到 Node.js，请先安装 Node.js 20+ (https://nodejs.org)"
  exit 1
fi

npm install
npm run dist:mac

echo "==> 构建完成！.dmg 安装包位于 ./dist 目录："
ls -lh dist/*.dmg
