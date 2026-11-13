#!/bin/sh
# Обновить плагин из сайта и опубликовать ветку moodle одной командой:
# копирует симулятор, пересобирает примеры и задания, проверяет плагин,
# коммитит и пушит ветку moodle.
#
#   ./tools/update.sh                  # сайт берётся из ../sim
#   ./tools/update.sh /путь/к/сайту    # из другого каталога
#
# Обычно запускать не нужно: ветку moodle обновляет ./sync.sh из ветки main
# (см. tools/update-moodle.sh там же).
set -e

cd "$(dirname "$0")/.."
src=${ROBOSIM_SRC:-../sim}
msg=""

# Первый аргумент — либо путь к сайту (в нём есть index.html), либо сообщение коммита.
for arg in "$@"; do
  if [ -f "$arg/index.html" ]; then
    src=$arg
  elif [ -z "$msg" ]; then
    msg=$arg
  fi
done

./tools/sync-simulator.sh "$src"

if command -v node >/dev/null 2>&1; then
  node tools/extract-examples.mjs "$src"
else
  echo "! node не найден — examples.json/tasks.json оставлены как были"
fi

if command -v php >/dev/null 2>&1; then
  php tools/selfcheck.php
else
  echo "! php не найден — самопроверка пропущена"
fi

./tools/release.sh "${msg:-simulator: синхронизация с сайтом}"
