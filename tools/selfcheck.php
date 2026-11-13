<?php
/**
 * Самопроверка плагина без установленного Moodle.
 *
 * Проверяет то, что можно проверить статически:
 *   • синтаксис всех PHP-файлов (php -l);
 *   • обязательные файлы плагина;
 *   • что все строки get_string() и {{#str}} есть в lang/en и lang/ru;
 *   • что переменные шаблона Mustache переданы из view.php;
 *   • что поля из install.xml совпадают с теми, что пишет код;
 *   • что используемые права объявлены в db/access.php;
 *   • синтаксис JS (node --check) и корректность JSON-файлов.
 *
 * Запуск:  php tools/selfcheck.php
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

$root = dirname(__DIR__) . '/mod/robosim';
$errors = [];
$warnings = [];
$checks = 0;

/**
 * Записывает ошибку проверки.
 */
function fail(string $message): void {
    global $errors;
    $errors[] = $message;
}

/**
 * Записывает предупреждение.
 */
function warn(string $message): void {
    global $warnings;
    $warnings[] = $message;
}

/**
 * Отмечает успешную проверку.
 */
function ok(): void {
    global $checks;
    $checks++;
}

/**
 * Рекурсивно собирает файлы по расширению.
 */
function files_with(string $root, string $extension): array {
    $out = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,
        FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isFile() && substr($file->getFilename(), -strlen($extension)) === $extension) {
            $out[] = $file->getPathname();
        }
    }
    sort($out);
    return $out;
}

// ------------------------------------------------------- обязательные файлы ----
$required = [
    'version.php', 'lib.php', 'mod_form.php', 'view.php', 'submit.php', 'report.php',
    'download.php', 'index.php', 'grade.php', 'settings.php', 'styles.css',
    'db/access.php', 'db/install.xml', 'db/upgrade.php',
    'lang/en/robosim.php', 'lang/ru/robosim.php',
    'classes/local/project.php', 'classes/privacy/provider.php',
    'classes/event/course_module_viewed.php', 'classes/event/submission_created.php',
    'backup/moodle2/backup_robosim_activity_task.class.php',
    'backup/moodle2/backup_robosim_stepslib.php',
    'backup/moodle2/restore_robosim_activity_task.class.php',
    'backup/moodle2/restore_robosim_stepslib.php',
    'templates/view.mustache', 'js/player.js',
    'simulator/index.html', 'simulator/styles.css', 'simulator/js/app.js',
    'examples.json', 'tasks.json',
];
foreach ($required as $file) {
    if (!file_exists("$root/$file")) {
        fail("нет обязательного файла $file");
    } else {
        ok();
    }
}

// ------------------------------------------------------------- php -l ---------
foreach (files_with($root, '.php') as $file) {
    $output = [];
    $code = 0;
    exec('php -l ' . escapeshellarg($file) . ' 2>&1', $output, $code);
    if ($code !== 0) {
        fail("синтаксис PHP: $file — " . implode(' ', $output));
    } else {
        ok();
    }
}

// ------------------------------------------------------------- version --------
$version = file_get_contents("$root/version.php");
if (!preg_match("/component\s*=\s*'mod_robosim'/", $version)) {
    fail('в version.php не указан компонент mod_robosim');
} else {
    ok();
}
if (!preg_match('/version\s*=\s*(\d{10})/', $version, $m)) {
    fail('в version.php нет корректного $plugin->version');
} else {
    ok();
}
if (preg_match('/requires\s*=\s*(\d{10})/', $version, $m) && (int) $m[1] < 2022041900) {
    warn('$plugin->requires меньше Moodle 4.0 — проверьте совместимость');
}

// ------------------------------------------------------------- строки ---------
$lang = [];
foreach (['en', 'ru'] as $langcode) {
    $content = file_get_contents("$root/lang/$langcode/robosim.php");
    preg_match_all("/\\\$string\\['([^']+)'\\]/", $content, $m);
    $lang[$langcode] = array_unique($m[1]);
    ok();
}
$used = [];
foreach (array_merge(files_with($root, '.php'), files_with($root, '.mustache')) as $file) {
    $content = file_get_contents($file);
    preg_match_all("/get_string\\(\\s*'([^']+)'\\s*,\\s*'mod_robosim'/", $content, $m);
    $used = array_merge($used, $m[1]);
    preg_match_all("/\\{\\{#str\\}\\}\\s*([a-z0-9_]+)\\s*,\\s*mod_robosim\\s*\\{\\{\\/str\\}\\}/i", $content, $m2);
    $used = array_merge($used, $m2[1]);
}
$used = array_unique($used);
foreach ($used as $key) {
    foreach (['en', 'ru'] as $langcode) {
        if (!in_array($key, $lang[$langcode], true)) {
            fail("строка '$key' не переведена в lang/$langcode");
        }
    }
}
ok();
foreach ($lang['en'] as $key) {
    if (!in_array($key, $lang['ru'], true)) {
        warn("строка '$key' есть в en, но нет в ru");
    }
}
foreach ($lang['ru'] as $key) {
    if (!in_array($key, $lang['en'], true)) {
        warn("строка '$key' есть в ru, но нет в en");
    }
}

// ------------------------------------------------------------- шаблон ---------
$template = file_get_contents("$root/templates/view.mustache");
$view = file_get_contents("$root/view.php");
// берём только массив $templatecontext — остальные ключи в файле не про шаблон
$start = strpos($view, '$templatecontext = [');
$end = strpos($view, "\n];", $start === false ? 0 : $start);
$block = $start === false ? '' : substr($view, $start, $end - $start);
// только ключи верхнего уровня (по 4 пробела отступа), вложенные массивы не считаем
preg_match_all("/^    '([a-z0-9_]+)'\\s*=>/m", $block, $m);
$provided = array_unique($m[1]);
preg_match_all("/\\{\\{\\s*[#^]?\\/?\\s*([a-z0-9_]+)\\s*\\}\\}/i", $template, $m2);
$helpers = ['str', 'pix', 'isset', 'js', 'quote', 'userdate', 'helplink', 'helpicon'];
$usedvars = [];
foreach ($m2[1] as $name) {
    if (!in_array(strtolower($name), $helpers, true)) {
        $usedvars[$name] = true;
    }
}
// ключи внутри блоков viewingsubmission
$inner = ['user', 'attempt', 'score', 'passed', 'failed', 'time', 'backurl'];
foreach (array_keys($usedvars) as $name) {
    if (in_array($name, $inner, true)) {
        continue;
    }
    if (!in_array($name, $provided, true)) {
        fail("шаблон использует переменную '$name', а view.php её не передаёт");
    }
}
ok();
foreach ($provided as $name) {
    if (!isset($usedvars[$name]) && !in_array($name, ['cangrade', 'autograde', 'attemptsleft', 'playerurlplain'])) {
        warn("view.php передаёт '$name', но шаблон её не использует");
    }
}

// ------------------------------------------------------------- база -----------
if (!function_exists('simplexml_load_file')) {
    // На сервере без php-xml (например, чистая консоль) проверку схемы пропускаем.
    warn('расширение simplexml не установлено — db/install.xml не проверен');
    $xml = null;
} else {
    $xml = @simplexml_load_file("$root/db/install.xml");
}
if ($xml === null && function_exists('simplexml_load_file')) {
    fail('db/install.xml не читается как XML');
} else if ($xml !== null) {
    ok();
    $tables = [];
    foreach ($xml->TABLES->TABLE as $table) {
        $name = (string) $table['NAME'];
        $fields = [];
        foreach ($table->FIELDS->FIELD as $field) {
            $fields[] = (string) $field['NAME'];
        }
        $tables[$name] = $fields;
        foreach (['id'] as $need) {
            if (!in_array($need, $fields, true)) {
                fail("в таблице $name нет поля $need");
            }
        }
    }
    foreach (['robosim', 'robosim_submissions'] as $need) {
        if (!isset($tables[$need])) {
            fail("в install.xml нет таблицы $need");
        }
    }

    // поля, которые пишет код, должны быть в схеме
    $lib = file_get_contents("$root/lib.php");
    preg_match('/function robosim_table_fields.*?return \[(.*?)\];/s', $lib, $m);
    if (!preg_match('/robosim_table_fields/', $lib)) {
        fail('в lib.php нет списка полей robosim_table_fields()');
    } else {
        preg_match_all("/'([a-z0-9_]+)'/", $m[1] ?? '', $usedfields);
        foreach ($usedfields[1] as $field) {
            if (!in_array($field, $tables['robosim'], true)) {
                fail("lib.php пишет поле '$field', которого нет в таблице robosim");
            }
        }
        ok();
    }

    $submission = ['robosimid', 'userid', 'attempt', 'schematic', 'code', 'score', 'passed',
        'checks', 'status', 'grade', 'timecreated', 'timemodified'];
    foreach ($submission as $field) {
        if (!in_array($field, $tables['robosim_submissions'], true)) {
            fail("в robosim_submissions нет поля '$field'");
        }
    }
    ok();
}

// ------------------------------------------------------------- права ----------
$access = file_get_contents("$root/db/access.php");
preg_match_all("/'(mod\\/robosim:[a-z]+)'\\s*=>/", $access, $m);
$declared = array_unique($m[1]);
$usedcaps = [];
foreach (array_merge(files_with($root, '.php')) as $file) {
    preg_match_all("/'(mod\\/robosim:[a-z]+)'/", file_get_contents($file), $mm);
    $usedcaps = array_merge($usedcaps, $mm[1]);
}
foreach (array_unique($usedcaps) as $cap) {
    if (!in_array($cap, $declared, true)) {
        fail("право $cap используется, но не объявлено в db/access.php");
    }
}
ok();

// ------------------------------------------------------------- JS и JSON ------
$node = trim((string) shell_exec('command -v node'));
if ($node !== '') {
    foreach (files_with("$root/js", '.js') as $file) {
        $output = [];
        $code = 0;
        exec('node --check ' . escapeshellarg($file) . ' 2>&1', $output, $code);
        if ($code !== 0) {
            fail('синтаксис JS: ' . basename($file) . ' — ' . implode(' ', $output));
        } else {
            ok();
        }
    }
} else {
    warn('node не найден — синтаксис JS не проверен');
}

foreach (['examples.json', 'tasks.json'] as $jsonfile) {
    $data = json_decode(file_get_contents("$root/$jsonfile"), true);
    if (!is_array($data)) {
        fail("$jsonfile — некорректный JSON");
    } else {
        ok();
    }
}

// ------------------------------------------------------------- итог -----------
echo "\nПроверок пройдено: $checks\n";
if ($warnings) {
    echo "Предупреждения (" . count($warnings) . "):\n";
    foreach ($warnings as $message) {
        echo "  ! $message\n";
    }
}
if ($errors) {
    echo "\nОшибки (" . count($errors) . "):\n";
    foreach ($errors as $message) {
        echo "  ✗ $message\n";
    }
    exit(1);
}

echo "Ошибок нет — плагин можно ставить в Moodle.\n";
exit(0);
