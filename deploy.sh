#!/bin/bash
set -e

# デプロイ時に CSS / JS の ?v= を現在日時スタンプで更新してキャッシュをバスト
VER=$(date +%Y%m%d%H%M%S)

sed -i '' "s/\?v=[^\"']*/?v=$VER/g" index.html

echo "✓ cache version: $VER"

git add index.html
git diff --cached --quiet || git commit -m "deploy: cache bust $VER"
git push

echo "✓ pushed to GitHub Pages"
