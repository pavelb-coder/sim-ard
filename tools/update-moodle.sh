#!/bin/sh
# После обновления сайта (ветка main) обновляет ветку moodle:
# копирует index.html/styles.css/js в mod/robosim/simulator, пересобирает
# examples.json и tasks.json, проверяет плагин и публикует ветку moodle.
#
# Вызывается автоматически из ./sync.sh, вручную — тоже можно:
#   ./tools/update-moodle.sh
#   ROBOSIM_MOODLE_WT=/путь/к/дереву/moodle ./tools/update-moodle.sh
#   SKIP_MOODLE=1 ./sync.sh         # обновить только сайт
#
# Скрипт не ломает деплой сайта: при проблемах печатает ✗ и выходит с кодом 0.
set -u

repo=$(cd "$(dirname "$0")/.." && pwd)
wt=${ROBOSIM_MOODLE_WT:-$repo/../moodle}

say() { printf '%s\n' "$*"; }

# 1. Есть ли рядом рабочее дерево ветки moodle?
if [ ! -f "$wt/tools/sync-simulator.sh" ]; then
  say "· ветка moodle не развёрнута рядом ($wt) — обновлять нечего"
  exit 0
fi

# 2. Рабочее дерево могло «отвалиться» после перезапуска песочницы:
#    обычно теряется только связка .git-файла с основным репозиторием.
if ! git -C "$wt" rev-parse --verify -q HEAD >/dev/null 2>&1; then
  say "· восстанавливаю рабочее дерево ветки moodle…"
  wtgit="$repo/.git/worktrees/moodle"
  if [ ! -f "$wtgit/gitdir" ]; then
    mkdir -p "$wtgit"
    printf '%s/.git\n' "$wt" > "$wtgit/gitdir"
    printf 'ref: refs/heads/moodle\n' > "$wtgit/HEAD"
    printf '../..\n' > "$wtgit/commondir"
  fi
  printf 'gitdir: %s\n' "$wtgit" > "$wt/.git"
  git -C "$repo" worktree repair "$wt" >/dev/null 2>&1 || true
  # индекс мог остаться от прежнего состояния — пересобираем из HEAD
  git -C "$wt" reset -q >/dev/null 2>&1 || true

  if ! git -C "$wt" rev-parse --verify -q HEAD >/dev/null 2>&1; then
    git -C "$repo" worktree add --force "$wt" moodle >/dev/null 2>&1 || true
  fi
  if ! git -C "$wt" rev-parse --verify -q HEAD >/dev/null 2>&1; then
    say "✗ не удалось восстановить рабочее дерево ветки moodle в $wt"
    say "  подсказка: git -C $repo worktree add /путь/к/moodle moodle"
    exit 0
  fi
  say "· рабочее дерево восстановлено"
fi

branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
if [ "$branch" != "moodle" ]; then
  say "· в $wt сейчас ветка «$branch», а не moodle — не трогаю её"
  exit 0
fi

src_short=$(git -C "$repo" rev-parse --short HEAD 2>/dev/null || echo "main")

# 3. Файлы симулятора → плагин.
say "· копирую симулятор main@$src_short в mod/robosim/simulator…"
if ! ( cd "$wt" && sh tools/sync-simulator.sh "$repo" ) >/tmp/robosim-moodle-sync.log 2>&1; then
  say "✗ не удалось скопировать симулятор:"
  tail -5 /tmp/robosim-moodle-sync.log
  exit 0
fi

# 4. Примеры и задания.
if command -v node >/dev/null 2>&1; then
  if ! ( cd "$wt" && node tools/extract-examples.mjs "$repo" ) >/dev/null 2>&1; then
    say "! examples.json/tasks.json не пересобрались — оставлены прежние"
  fi
else
  say "! node не найден — examples.json/tasks.json оставлены как были"
fi

# 5. Самопроверка плагина (если в системе есть php).
if command -v php >/dev/null 2>&1; then
  if ! ( cd "$wt" && php tools/selfcheck.php ) >/tmp/robosim-moodle-check.log 2>&1; then
    say "✗ самопроверка плагина не прошла — ветку moodle не обновляю:"
    tail -15 /tmp/robosim-moodle-check.log
    exit 0
  fi
  say "· самопроверка плагина: ок"
fi

# 6. Коммит и пуш только если что-то поменялось.
if [ -z "$(git -C "$wt" status --porcelain)" ]; then
  say "· ветка moodle уже актуальна — симулятор в плагине не изменился"
  exit 0
fi

if ! ( cd "$wt" && git add -A && git commit -q -m "simulator: синхронизация с main@$src_short" ); then
  say "✗ не удалось закоммитить ветку moodle"
  exit 0
fi

if ( cd "$wt" && git push -q origin HEAD:moodle ); then
  say "✓ ветка moodle обновлена: $(git -C "$wt" rev-parse --short HEAD) (симулятор из main@$src_short)"
else
  say "✗ не удалось запушить ветку moodle (коммит сделан локально)"
fi

exit 0
