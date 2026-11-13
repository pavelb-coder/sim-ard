#!/bin/sh
# Копирует сам симулятор в плагин: сайт из ветки main → mod/robosim/simulator.
#
#   ./tools/sync-simulator.sh [путь-к-сайту]
#
# По умолчанию берётся $ROBOSIM_SRC, затем ../sim (рядом с этой веткой).
# После копирования не забудьте обновить examples.json/tasks.json:
#   node tools/extract-examples.mjs [путь-к-сайту]
set -e

here=$(cd "$(dirname "$0")/.." && pwd)
src=${1:-${ROBOSIM_SRC:-$here/../sim}}
dst="$here/mod/robosim/simulator"

if [ ! -f "$src/index.html" ]; then
  echo "Не нахожу симулятор в $src (нужен index.html)." >&2
  echo "Укажите путь: ./tools/sync-simulator.sh /путь/к/сайту" >&2
  exit 1
fi

rm -rf "$dst"
mkdir -p "$dst/js"
cp "$src/index.html" "$dst/index.html"
cp "$src/styles.css" "$dst/styles.css"
# только то, что нужно странице: скрипты и режим ROS
cp -R "$src/js/." "$dst/js/"

# служебные файлы сайта в плагине не нужны
rm -rf "$dst/js/tests" 2>/dev/null || true

echo "Симулятор скопирован: $dst"
du -sh "$dst"
