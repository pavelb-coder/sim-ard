#!/bin/sh
# Коммит и публикация этой ветки. Пушит ТОЛЬКО в ветку moodle:
# main (сайт) эта ветка не трогает, деплой сайта остаётся независимым.
#
#   ./tools/release.sh "сообщение коммита"
set -e

cd "$(dirname "$0")/.."

git config user.name  >/dev/null 2>&1 || git config user.name  "RoboSim"
git config user.email >/dev/null 2>&1 || git config user.email "robosim@users.noreply.github.com"
git config core.sshCommand >/dev/null 2>&1 || git config core.sshCommand \
  "ssh -i $HOME/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

msg=${1:-"moodle: обновление плагина $(date -u '+%Y-%m-%d %H:%M UTC')"}

git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "$msg"
fi
git push -q origin HEAD:moodle
echo "✓ ветка moodle: $(git rev-parse --short HEAD) → $(git remote get-url origin)"

# ---------------------------------------------------------------- архив ------
# mod_robosim-<версия>.zip — готовый к установке плагин: распаковать в mod/ Moodle.
ver=$(sed -n "s/.*release *= *'\([0-9][0-9.]*\).*/\1/p" mod/robosim/version.php | head -1)
[ -n "$ver" ] || ver=dev
out="../mod_robosim-$ver.zip"
tmp=$(mktemp -d)
cp -a mod/robosim "$tmp/robosim"
rm -rf "$tmp/robosim/.git"
(cd "$tmp" && zip -qr "$(cd "$OLDPWD" && pwd)/$out" robosim)
rm -rf "$tmp"
echo "✓ архив: $(cd .. && pwd)/mod_robosim-$ver.zip"
