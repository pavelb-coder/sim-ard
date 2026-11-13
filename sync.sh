#!/bin/sh
# Синхронизация с GitHub: git@github.com:pavelb-coder/sim-ard.git
#
# Авторизация — деплой-ключ ~/.ssh/id_ed25519 (он лежит в домашней папке и переживает
# перезапуск песочницы). Права ключа ограничены этим репозиторием — доступа к аккаунту нет.
#
#   ./sync.sh                  закоммитить всё и запушить в main
#   ./sync.sh "сообщение"      со своим сообщением коммита
set -e
cd "$(dirname "$0")"

REPO="git@github.com:pavelb-coder/sim-ard.git"

# .git/config не попадает в снапшоты песочницы — восстанавливаем то, без чего не запушить
git config user.name  >/dev/null 2>&1 || git config user.name  "RoboSim"
git config user.email >/dev/null 2>&1 || git config user.email "robosim@users.noreply.github.com"
git config core.sshCommand >/dev/null 2>&1 || git config core.sshCommand \
  "ssh -i $HOME/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REPO"
git remote set-url origin "$REPO"

MSG="${1:-sync: $(date -u '+%Y-%m-%d %H:%M UTC')}"
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "$MSG"
fi

git push -q origin HEAD:main
echo "✓ синхронизировано $(git rev-parse --short HEAD) → https://github.com/pavelb-coder/sim-ard"

# Ветка moodle живёт вместе с сайтом: плагин Moodle содержит копию симулятора,
# поэтому после каждого обновления main обновляем и её (SKIP_MOODLE=1 — пропустить).
if [ "${SKIP_MOODLE:-0}" != "1" ] && [ -x tools/update-moodle.sh ]; then
  ./tools/update-moodle.sh
fi
