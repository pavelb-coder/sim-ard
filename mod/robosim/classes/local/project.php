<?php
/**
 * Работа с проектами RoboSim: примеры, задания, ссылки-токены.
 *
 * Симулятор принимает состояние схемы через хеш `#p=<токен>`, где токен —
 * это base64url от JSON {"v":3,"s":<схема>,"c":<скетч>}. Ровно такой же
 * токен формирует сам сайт кнопкой «Ссылка на схему», поэтому плагин и
 * сайт совместимы в обе стороны.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_robosim\local;

defined('MOODLE_INTERNAL') || die();

/**
 * Каталог проектов и преобразование «схема + скетч → токен».
 */
class project {

    /** @var string компонент плагина */
    const COMPONENT = 'mod_robosim';

    /** @var string область файлов с проектом учителя */
    const FILEAREA = 'project';

    /** @var int максимальная длина принимаемой схемы (защита от мусора) */
    const MAX_JSON = 4 * 1024 * 1024;

    /** @var array|null кеш примеров */
    private static $examples = null;

    /** @var array|null кеш заданий */
    private static $tasks = null;

    /**
     * Читает JSON-файл из каталога плагина.
     *
     * @param string $name имя файла без расширения
     * @return array
     */
    private static function read_json(string $name): array {
        $path = __DIR__ . '/../../' . $name . '.json';
        if (!is_readable($path)) {
            return [];
        }
        $data = json_decode((string) file_get_contents($path), true);
        return is_array($data) ? $data : [];
    }

    /**
     * Встроенные примеры симулятора: id => данные.
     *
     * @return array
     */
    public static function examples(): array {
        if (self::$examples === null) {
            self::$examples = [];
            foreach (self::read_json('examples')['examples'] ?? [] as $example) {
                if (!empty($example['id'])) {
                    self::$examples[$example['id']] = $example;
                }
            }
        }
        return self::$examples;
    }

    /**
     * Список «id => название» для выпадающего меню настроек.
     *
     * @return array
     */
    public static function example_menu(): array {
        $menu = [];
        foreach (self::examples() as $id => $example) {
            $menu[$id] = $example['name'] ?? $id;
        }
        return $menu;
    }

    /**
     * Учебные задания из панели «Задания».
     *
     * @return array
     */
    public static function tasks(): array {
        if (self::$tasks === null) {
            self::$tasks = [];
            foreach (self::read_json('tasks')['tasks'] ?? [] as $task) {
                if (!empty($task['id'])) {
                    self::$tasks[$task['id']] = $task;
                }
            }
        }
        return self::$tasks;
    }

    /**
     * Список «id => название» заданий для меню.
     *
     * @return array
     */
    public static function task_menu(): array {
        $menu = [];
        // задания курса идут по возрастанию уровня: в списке из 31 пункта так проще искать
        $ordered = array_values(self::tasks());
        usort($ordered, fn($a, $b) => ((int) ($a['level'] ?? 0)) <=> ((int) ($b['level'] ?? 0)));
        foreach ($ordered as $task) {
            $level = (int) ($task['level'] ?? 0);
            $title = $task['title'] ?? $task['id'];
            $menu[$task['id']] = $level > 0 ? "{$level} · {$title}" : $title;
        }
        return $menu;
    }

    /**
     * Схема + скетч → токен для ссылки симулятора.
     *
     * @param array $schematic схема в формате schematic.toJSON()
     * @param string $code скетч
     * @return string base64url без выравнивания
     */
    public static function encode_token(array $schematic, string $code): string {
        $json = json_encode(
            ['v' => 3, 's' => $schematic, 'c' => $code],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
        return rtrim(strtr(base64_encode((string) $json), '+/', '-_'), '=');
    }

    /**
     * Токен → схема и скетч.
     *
     * @param string $token токен из ссылки
     * @return array|null ['schematic' => array, 'code' => string] или null
     */
    public static function decode_token(string $token): ?array {
        $token = trim($token);
        if ($token === '' || strlen($token) > self::MAX_JSON * 2) {
            return null;
        }
        $b64 = strtr($token, '-_', '+/');
        $padding = strlen($b64) % 4;
        if ($padding) {
            $b64 .= str_repeat('=', 4 - $padding);
        }
        $json = base64_decode($b64, true);
        if ($json === false) {
            return null;
        }
        return self::normalise($json);
    }

    /**
     * Приводит произвольный JSON к виду «схема + скетч».
     *
     * Понимает: токен, JSON из кнопки «Сохранить» ({app:'robosim', schematic, code}),
     * внутренний формат ссылки ({v:3, s, c}) и просто схему ({parts, wires}).
     *
     * @param string $raw строка JSON или токен
     * @return array|null ['schematic' => array, 'code' => string]
     */
    public static function normalise(string $raw): ?array {
        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }
        if (strlen($raw) > self::MAX_JSON) {
            return null;
        }
        if ($raw[0] !== '{') {
            // Похоже на токен, а не на JSON.
            $decoded = self::decode_token($raw);
            return $decoded;
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return null;
        }
        $schematic = null;
        $code = '';
        if (isset($data['s']) && is_array($data['s'])) {
            $schematic = $data['s'];
            $code = isset($data['c']) ? (string) $data['c'] : '';
        } else if (isset($data['schematic']) && is_array($data['schematic'])) {
            $schematic = $data['schematic'];
            $code = isset($data['code']) ? (string) $data['code'] : '';
        } else if (isset($data['parts'])) {
            $schematic = $data;
            $code = isset($data['code']) ? (string) $data['code'] : '';
        }
        if (!is_array($schematic) || !isset($schematic['parts']) || !is_array($schematic['parts'])) {
            return null;
        }
        // Оставляем только то, что понимает симулятор, — так безопаснее хранить.
        $clean = [
            'version' => (int) ($schematic['version'] ?? 1),
            'parts' => $schematic['parts'],
            'wires' => $schematic['wires'] ?? [],
        ];
        if (isset($schematic['view'])) {
            $clean['view'] = $schematic['view'];
        }
        return ['schematic' => $clean, 'code' => $code];
    }

    /**
     * Проект, с которого начинает ученик: из файла, из текста или из примера/задания.
     *
     * @param \stdClass $robosim запись элемента курса
     * @param \context_module $context контекст
     * @return array ['token' => string, 'schematic' => array, 'code' => string, 'source' => string, 'task' => string]
     */
    public static function instance_project(\stdClass $robosim, \context_module $context): array {
        $empty = ['token' => '', 'schematic' => ['parts' => [], 'wires' => []], 'code' => '', 'source' => 'empty', 'task' => ''];

        // 1. Файл, приложенный учителем.
        $fs = get_file_storage();
        $files = $fs->get_area_files($context->id, self::COMPONENT, self::FILEAREA, 0, 'sortorder, filename', false);
        foreach ($files as $file) {
            if ($file->is_directory() || $file->get_filesize() > self::MAX_JSON) {
                continue;
            }
            $project = self::normalise((string) $file->get_content());
            if ($project) {
                $project['source'] = 'file:' . $file->get_filename();
                $project['task'] = '';
                $project['token'] = self::encode_token($project['schematic'], $project['code']);
                return $project;
            }
        }

        // 2. Своя схема, вставленная текстом (токен или JSON).
        $custom = trim((string) ($robosim->customproject ?? ''));
        if ($custom !== '') {
            $project = self::normalise($custom);
            if ($project) {
                $project['source'] = 'custom';
                $project['task'] = '';
                $project['token'] = self::encode_token($project['schematic'], $project['code']);
                return $project;
            }
        }

        $preset = (string) ($robosim->preset ?? 'custom');
        [$kind, $id] = array_pad(explode(':', $preset, 2), 2, '');

        // 3. Задание из набора: берём заготовку и запоминаем id для автопроверки.
        if ($kind === 'task' && isset(self::tasks()[$id])) {
            $task = self::tasks()[$id];
            $schematic = $task['start']['schematic'] ?? ['parts' => [], 'wires' => []];
            $code = (string) ($task['start']['code'] ?? '');
            return [
                'token' => self::encode_token($schematic, $code),
                'schematic' => $schematic,
                'code' => $code,
                'source' => 'task:' . $id,
                'task' => $id,
            ];
        }

        // 4. Встроенный пример.
        if ($kind === 'example' && isset(self::examples()[$id])) {
            $example = self::examples()[$id];
            $schematic = $example['schematic'] ?? ['parts' => [], 'wires' => []];
            $code = (string) ($example['code'] ?? '');
            return [
                'token' => self::encode_token($schematic, $code),
                'schematic' => $schematic,
                'code' => $code,
                'source' => 'example:' . $id,
                'task' => '',
            ];
        }

        // 5. Пустая доска: ученик собирает схему с нуля.
        return $empty;
    }

    /**
     * Ссылка на страницу симулятора.
     *
     * По умолчанию — встроенная копия внутри плагина; админ может указать
     * внешний адрес (например, опубликованный сайт), тогда берётся он.
     *
     * @return string
     */
    public static function simulator_url(): string {
        $external = trim((string) get_config(self::COMPONENT, 'simurl'));
        if ($external !== '' && get_config(self::COMPONENT, 'allowexternal')) {
            return $external;
        }
        return (new \moodle_url('/mod/robosim/simulator/index.html'))->out(false);
    }

    /**
     * Полная ссылка на симулятор с загруженным проектом.
     *
     * @param string $token токен проекта (может быть пустым)
     * @return string
     */
    public static function player_url(string $token): string {
        $url = self::simulator_url();
        if ($token !== '') {
            $url .= '#p=' . $token;
        }
        return $url;
    }

    /**
     * Сколько попыток уже сделал ученик.
     *
     * @param int $robosimid id элемента курса
     * @param int $userid id пользователя
     * @return int
     */
    public static function count_attempts(int $robosimid, int $userid): int {
        global $DB;
        return (int) $DB->count_records('robosim_submissions', ['robosimid' => $robosimid, 'userid' => $userid]);
    }

    /**
     * Последняя попытка ученика.
     *
     * @param int $robosimid id элемента курса
     * @param int $userid id пользователя
     * @return \stdClass|false
     */
    public static function last_attempt(int $robosimid, int $userid) {
        global $DB;
        $records = $DB->get_records('robosim_submissions',
            ['robosimid' => $robosimid, 'userid' => $userid], 'attempt DESC, id DESC', '*', 0, 1);
        return reset($records);
    }

    /**
     * Название задания по его id (для подписи на странице).
     *
     * @param string $id идентификатор задания
     * @return string
     */
    public static function task_title(string $id): string {
        if ($id === '') {
            return '';
        }
        $tasks = self::tasks();
        return (string) ($tasks[$id]['title'] ?? $id);
    }

    /**
     * Человеческое название источника проекта.
     *
     * @param string $source строка вида example:blink, task:led-first, file:…
     * @return string
     */
    public static function describe_source(string $source): string {
        [$kind, $id] = array_pad(explode(':', $source, 2), 2, '');
        switch ($kind) {
            case 'example':
                return get_string('source_example', self::COMPONENT, self::examples()[$id]['name'] ?? $id);
            case 'task':
                return get_string('source_task', self::COMPONENT, self::tasks()[$id]['title'] ?? $id);
            case 'file':
                return get_string('source_file', self::COMPONENT, $id);
            case 'custom':
                return get_string('source_custom', self::COMPONENT);
            case 'submission':
                return get_string('source_submission', self::COMPONENT);
            default:
                return get_string('source_empty', self::COMPONENT);
        }
    }
}
