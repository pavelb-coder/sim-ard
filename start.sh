#!/bin/sh
# Локальный запуск RoboSim — http://localhost:8000
# Нужен только Python 3 (или Node.js). Ничего устанавливать в проект не надо.
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
URL="http://localhost:$PORT"

open_browser() {
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$URL"
  fi
}

if command -v python3 >/dev/null 2>&1; then
  echo "RoboSim → $URL   (Ctrl+C — остановить)"
  open_browser &
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  echo "RoboSim → $URL   (Ctrl+C — остановить)"
  open_browser &
  exec python -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  echo "RoboSim → $URL   (Ctrl+C — остановить)"
  open_browser &
  exec npx --yes serve -l "$PORT" .
else
  echo "Не найден Python 3 или Node.js."
  echo "Поставьте Python с https://www.python.org/downloads/ и запустите start.sh снова."
  exit 1
fi
