#!/bin/sh
# Установка Moodle 4.5 LTS вместе с плагином RoboSim на Ubuntu/Debian.
#
#   sudo ./tools/install-moodle-ubuntu.sh
#
# Скрипт ставит Apache, MariaDB, PHP и нужные расширения, скачивает Moodle,
# копирует плагин в mod/robosim, создаёт базу и moodledata, прогоняет установку
# из командной строки и печатает адрес сайта с логином администратора.
#
# Всё можно переопределить переменными окружения, например:
#   sudo MOODLE_BRANCH=405 ADMIN_PASS='МойПароль123!' ./tools/install-moodle-ubuntu.sh
#
# Важно про версии: плагин поддерживает Moodle 4.0–5.0. Moodle 4.5 LTS (ветка 405)
# требует PHP 8.1–8.3 — в Ubuntu 22.04 это PHP 8.1, в 24.04 — PHP 8.3, обе подходят.
set -e

MOODLE_BRANCH=${MOODLE_BRANCH:-405}
MOODLE_DIR=${MOODLE_DIR:-/var/www/moodle}
MOODLE_DATA=${MOODLE_DATA:-/var/www/moodledata}
MOODLE_URL=${MOODLE_URL:-http://localhost}
ADMIN_USER=${ADMIN_USER:-admin}
ADMIN_PASS=${ADMIN_PASS:-Robosim123!}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
SITE_NAME=${SITE_NAME:-"Школа RoboSim"}
SITE_SHORT=${SITE_SHORT:-robosim}
DB_NAME=${DB_NAME:-moodle}
DB_USER=${DB_USER:-moodle}
DB_PASS=${DB_PASS:-moodle}

say() { printf '\n=== %s\n' "$*"; }

if [ "$(id -u)" != "0" ]; then
  echo "Нужны права root: sudo $0" >&2
  exit 1
fi

src=$(cd "$(dirname "$0")/.." && pwd)
if [ ! -f "$src/mod/robosim/version.php" ]; then
  echo "Не нахожу плагин рядом со скриптом ($src/mod/robosim)." >&2
  echo "Запускайте скрипт из каталога ветки moodle." >&2
  exit 1
fi

say "1/7 Пакеты (Apache, MariaDB, PHP)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y apache2 mariadb-server curl ca-certificates \
  php libapache2-mod-php php-cli php-mysql php-xml php-mbstring php-curl \
  php-zip php-gd php-intl php-soap php-bcmath php-common

say "2/7 Настройки PHP (память, поля формы, загрузка)"
phpini=$(php -r 'echo php_ini_loaded_file();')
if [ -n "$phpini" ] && [ -f "$phpini" ]; then
  sed -i 's/^memory_limit.*/memory_limit = 256M/' "$phpini"
  sed -i 's/^max_input_vars.*/max_input_vars = 5000/' "$phpini" || true
  sed -i 's/^;max_input_vars.*/max_input_vars = 5000/' "$phpini" || true
  sed -i 's/^upload_max_filesize.*/upload_max_filesize = 128M/' "$phpini"
  sed -i 's/^post_max_size.*/post_max_size = 128M/' "$phpini"
  echo "правлен $phpini"
fi

say "3/7 База данных"
service mariadb start >/dev/null 2>&1 || service mysql start >/dev/null 2>&1 || true
sleep 2
mariadb -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mariadb -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';"
mariadb -e "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';"
mariadb -e "FLUSH PRIVILEGES;"
echo "база $DB_NAME готова"

say "4/7 Moodle $MOODLE_BRANCH"
if [ -f "$MOODLE_DIR/version.php" ]; then
  echo "Moodle уже распакован в $MOODLE_DIR — код не трогаю"
else
  curl -fsSL -o /tmp/moodle.tgz \
    "https://download.moodle.org/download.php/direct/stable$MOODLE_BRANCH/moodle-latest-$MOODLE_BRANCH.tgz"
  mkdir -p "$MOODLE_DIR"
  tar -xzf /tmp/moodle.tgz -C "$MOODLE_DIR" --strip-components=1
  rm -f /tmp/moodle.tgz
  echo "распакован в $MOODLE_DIR"
fi

say "5/7 Плагин mod_robosim"
rm -rf "$MOODLE_DIR/mod/robosim"
cp -R "$src/mod/robosim" "$MOODLE_DIR/mod/robosim"
echo "скопирован: $MOODLE_DIR/mod/robosim"

say "6/7 Права и moodledata"
mkdir -p "$MOODLE_DATA"
chown -R www-data:www-data "$MOODLE_DATA"
chown -R root:root "$MOODLE_DIR"
chmod -R 0755 "$MOODLE_DIR"
chown -R www-data:www-data "$MOODLE_DIR/mod/robosim/simulator" || true

if [ -f "$MOODLE_DIR/config.php" ]; then
  echo "config.php уже есть — установку пропускаю"
else
  say "7/7 Установка Moodle (5–10 минут)"
  cd "$MOODLE_DIR"
  sudo -u www-data php admin/cli/install.php \
    --wwwroot="$MOODLE_URL" \
    --dataroot="$MOODLE_DATA" \
    --dbtype=mariadb \
    --dbhost=localhost \
    --dbname="$DB_NAME" \
    --dbuser="$DB_USER" \
    --dbpass="$DB_PASS" \
    --fullname="$SITE_NAME" \
    --shortname="$SITE_SHORT" \
    --adminuser="$ADMIN_USER" \
    --adminpass="$ADMIN_PASS" \
    --adminemail="$ADMIN_EMAIL" \
    --non-interactive \
    --agree-license
fi

# Apache смотрит на /var/www/html; отдаём корень сайта из /var/www/moodle
if [ "$MOODLE_DIR" != "/var/www/html" ]; then
  cat > /etc/apache2/sites-available/moodle.conf <<CONF
<VirtualHost *:80>
    DocumentRoot $MOODLE_DIR
    <Directory $MOODLE_DIR>
        Options FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    ErrorLog \${APACHE_LOG_DIR}/moodle-error.log
    CustomLog \${APACHE_LOG_DIR}/moodle-access.log combined
</VirtualHost>
CONF
  a2dissite 000-default >/dev/null 2>&1 || true
  a2ensite moodle >/dev/null 2>&1 || true
  a2enmod rewrite >/dev/null 2>&1 || true
  service apache2 restart >/dev/null 2>&1 || true
fi

say "Готово"
cat <<INFO
Сайт:            $MOODLE_URL
Администратор:   $ADMIN_USER / $ADMIN_PASS
Moodle:          $MOODLE_DIR
Данные:          $MOODLE_DATA
Плагин:          $MOODLE_DIR/mod/robosim

Что дальше:
  1. Войдите администратором и создайте курс.
  2. В курсе: «Добавить элемент или ресурс» → «Симулятор RoboSim».
  3. Выберите задание (например, «Первый светодиод»), поставьте максимальную
     оценку и включите «Выставлять оценку сразу, когда автопроверка пройдена».

Полезное:
  sudo -u www-data php $MOODLE_DIR/admin/cli/cron.php     # фоновые задачи
  sudo -u www-data php $MOODLE_DIR/admin/cli/purge_caches.php
INFO
