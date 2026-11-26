#!/usr/bin/env bash
# 打开浏览器扩展管理页，引导“加载已解压扩展”。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

if command -v google-chrome >/dev/null 2>&1; then
  BROWSER="google-chrome"; PAGE="chrome://extensions"
elif command -v chromium >/dev/null 2>&1; then
  BROWSER="chromium"; PAGE="chrome://extensions"
elif command -v chromium-browser >/dev/null 2>&1; then
  BROWSER="chromium-browser"; PAGE="chrome://extensions"
elif command -v firefox >/dev/null 2>&1; then
  BROWSER="firefox"; PAGE="about:debugging#/runtime/this-firefox"
else
  echo "未找到 Chrome/Chromium/Firefox。请手动打开扩展管理页并加载目录：$DIR"
  exit 0
fi

echo "扩展目录：$DIR"
echo "正在打开 $BROWSER 的扩展管理页..."
echo "  Chrome: 开启开发者模式 → 加载已解压的扩展程序 → 选择上面的目录"
echo "  Firefox: 加载临时附加组件 → 选择 $DIR/manifest.json"
"$BROWSER" "$PAGE" >/dev/null 2>&1 &
