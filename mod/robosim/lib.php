<?php
/**
 * Основные функции плагина RoboSim (элемент курса).
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

use mod_robosim\local\project;

defined('MOODLE_INTERNAL') || die();

/**
 * Возможности элемента курса.
 *
 * @param string $feature FEATURE_xx
 * @return mixed true/false или null, если функция неизвестна
 */
function robosim_supports($feature) {
    switch ($feature) {
        case FEATURE_GRADE_HAS_GRADE:
            return true;
        case FEATURE_COMPLETION_TRACKS_VIEWS:
            return true;
        case FEATURE_COMPLETION_HAS_RULES:
            return true;
        case FEATURE_MOD_INTRO:
            return true;
        case FEATURE_SHOW_DESCRIPTION:
            return true;
        case FEATURE_BACKUP_MOODLE2:
            return true;
        case FEATURE_GRADE_OUTCOMES:
            return false;
        default:
            return null;
    }
}

/**
 * Поля таблицы robosim — только они попадают в БД.
 *
 * @return array
 */
function robosim_table_fields(): array {
    return ['course', 'name', 'intro', 'introformat', 'preset', 'customproject', 'prompt',
        'promptformat', 'autograde', 'maxattempts', 'grade', 'timemodified'];
}

/**
 * Приводит данные формы к записи таблицы robosim.
 *
 * Форма присылает десятки служебных полей (coursemodule, projectfile, редакторы),
 * поэтому в базу уходит только то, что описано в install.xml.
 *
 * @param \stdClass $data данные формы
 * @return \stdClass запись для БД
 */
function robosim_normalise_data(\stdClass $data): \stdClass {
    $record = new \stdClass();

    // Редактор присылает массив «текст + формат».
    if (isset($data->prompt) && is_array($data->prompt)) {
        $data->promptformat = (int) ($data->prompt['format'] ?? FORMAT_HTML);
        $data->prompt = (string) ($data->prompt['text'] ?? '');
    }
    if (isset($data->intro) && is_array($data->intro)) {
        $data->introformat = (int) ($data->intro['format'] ?? FORMAT_HTML);
        $data->intro = (string) ($data->intro['text'] ?? '');
    }

    foreach (robosim_table_fields() as $field) {
        if (property_exists($data, $field)) {
            $record->$field = $data->$field;
        }
    }

    $record->preset = trim((string) ($record->preset ?? 'custom'));
    if ($record->preset === '') {
        $record->preset = 'custom';
    }
    $record->customproject = trim((string) ($record->customproject ?? ''));
    $record->prompt = (string) ($record->prompt ?? '');
    $record->promptformat = (int) ($record->promptformat ?? FORMAT_HTML);
    $record->autograde = empty($record->autograde) ? 0 : 1;
    $record->maxattempts = max(0, (int) ($record->maxattempts ?? 0));
    $record->grade = max(0, (float) ($record->grade ?? 0));
    $record->timemodified = time();

    return $record;
}

/**
 * Сохраняет файл проекта из черновика в постоянное хранилище плагина.
 *
 * @param \stdClass $data данные формы
 * @param \context_module $context контекст элемента курса
 * @return void
 */
function robosim_save_project_files(\stdClass $data, \context_module $context): void {
    if (empty($data->projectfile)) {
        return;
    }
    file_save_draft_area_files(
        (int) $data->projectfile,
        $context->id,
        'mod_robosim',
        project::FILEAREA,
        0,
        ['subdirs' => 0, 'maxfiles' => 1, 'maxbytes' => project::MAX_JSON]
    );
}

/**
 * Добавляет новый элемент курса.
 *
 * @param \stdClass $data данные формы
 * @param \mod_robosim_mod_form|null $mform форма
 * @return int id созданной записи
 */
function robosim_add_instance(\stdClass $data, $mform = null) {
    global $DB;

    $record = robosim_normalise_data($data);
    $record->course = (int) $record->course;
    $record->id = $DB->insert_record('robosim', $record);

    // На этом шаге элемент курса уже создан — берём его id из данных формы.
    $cmid = !empty($data->coursemodule) ? (int) $data->coursemodule
        : (int) (get_coursemodule_from_instance('robosim', $record->id, $record->course)->id ?? 0);
    if ($cmid) {
        robosim_save_project_files($data, \context_module::instance($cmid));
    }

    robosim_grade_item_update($record);

    return $record->id;
}

/**
 * Обновляет элемент курса.
 *
 * @param \stdClass $data данные формы
 * @param \mod_robosim_mod_form|null $mform форма
 * @return bool
 */
function robosim_update_instance(\stdClass $data, $mform = null) {
    global $DB;

    $record = robosim_normalise_data($data);
    $record->id = (int) $data->instance;
    $record->course = (int) ($data->course ?? $record->course ?? 0);

    $DB->update_record('robosim', $record);

    $cmid = !empty($data->coursemodule) ? (int) $data->coursemodule
        : (int) (get_coursemodule_from_instance('robosim', $record->id, $record->course)->id ?? 0);
    if ($cmid) {
        robosim_save_project_files($data, \context_module::instance($cmid));
    }

    robosim_grade_item_update($record);

    return true;
}

/**
 * Удаляет элемент курса вместе со сданными работами и файлами.
 *
 * @param int $id id элемента курса
 * @return bool
 */
function robosim_delete_instance($id) {
    global $DB;

    if (!$robosim = $DB->get_record('robosim', ['id' => $id])) {
        return false;
    }

    $DB->delete_records('robosim_submissions', ['robosimid' => $robosim->id]);
    $DB->delete_records('robosim', ['id' => $robosim->id]);

    if ($cm = get_coursemodule_from_instance('robosim', $robosim->id)) {
        $context = \context_module::instance($cm->id);
        $fs = get_file_storage();
        $fs->delete_area_files($context->id, 'mod_robosim', project::FILEAREA);
        $fs->delete_area_files($context->id, 'mod_robosim', 'intro');
    }

    robosim_grade_item_delete($robosim);

    return true;
}

/**
 * Удаляет элемент оценки из журнала.
 *
 * @param \stdClass $robosim запись элемента курса
 * @return bool
 */
function robosim_grade_item_delete($robosim) {
    global $CFG;
    require_once($CFG->libdir . '/gradelib.php');
    return grade_update('mod/robosim', $robosim->course, 'mod', 'robosim', $robosim->id, 0, null,
        ['deleted' => 1]);
}

/**
 * Создаёт или обновляет элемент оценки.
 *
 * @param \stdClass $robosim запись элемента курса
 * @param array|null $grades оценки
 * @return int
 */
function robosim_grade_item_update($robosim, $grades = null) {
    global $CFG;
    require_once($CFG->libdir . '/gradelib.php');

    $grades = robosim_key_grades($grades);

    $params = [
        'itemname' => $robosim->name,
        'gradetype' => GRADE_TYPE_VALUE,
        'grademax' => (float) $robosim->grade,
        'grademin' => 0,
    ];
    if ($grades === 'reset') {
        $params['reset'] = true;
        $grades = null;
    }

    return grade_update('mod/robosim', $robosim->course, 'mod', 'robosim', $robosim->id, 0, $grades, $params);
}

/**
 * Приводит список оценок к виду, который требует grade_update(): ключ — id ученика.
 *
 * Ядро Moodle принимает только $grades[$userid], всё остальное молча игнорирует
 * с сообщением «Incorrect grade array index, must be user id». Поэтому здесь
 * принимаем и обычный список, и ассоциативный массив.
 *
 * @param array|string|null $grades оценки
 * @return array|null
 */
function robosim_key_grades($grades) {
    if (!is_array($grades)) {
        return $grades;
    }
    $keyed = [];
    foreach ($grades as $userid => $grade) {
        if (is_object($grade)) {
            $grade->userid = (int) ($grade->userid ?? $userid);
            $keyed[$grade->userid] = $grade;
        } else if (is_array($grade)) {
            $grade['userid'] = (int) ($grade['userid'] ?? $userid);
            $keyed[$grade['userid']] = (object) $grade;
        }
    }
    return $keyed ?: null;
}

/**
 * Пересчитывает оценки ученику (или всем).
 *
 * @param \stdClass $robosim запись элемента курса
 * @param int $userid 0 — всем
 * @param bool $nullifnone обнулять оценки, если работ нет
 * @return void
 */
function robosim_update_grades($robosim, $userid = 0, $nullifnone = true) {
    global $DB;

    if (!$robosim->grade) {
        robosim_grade_item_update($robosim);
        return;
    }

    if ($userid) {
        $best = robosim_best_score((int) $robosim->id, (int) $userid);
        $grade = $best === null
            ? ($nullifnone ? ['userid' => $userid, 'rawgrade' => null] : null)
            : ['userid' => $userid, 'rawgrade' => round($robosim->grade * $best / 100, 5)];
        robosim_grade_item_update($robosim, $grade === null ? null : [$grade]);
        return;
    }

    $users = $DB->get_records_sql(
        'SELECT userid, MAX(score) AS best
           FROM {robosim_submissions}
          WHERE robosimid = ?
       GROUP BY userid',
        [$robosim->id]
    );
    $grades = [];
    foreach ($users as $row) {
        $grades[] = ['userid' => $row->userid, 'rawgrade' => round($robosim->grade * (float) $row->best / 100, 5)];
    }
    robosim_grade_item_update($robosim, $grades ?: null);
}

/**
 * Лучший результат ученика в процентах.
 *
 * @param int $robosimid id элемента курса
 * @param int $userid id пользователя
 * @return float|null
 */
function robosim_best_score(int $robosimid, int $userid): ?float {
    global $DB;
    $sql = 'SELECT MAX(score) FROM {robosim_submissions} WHERE robosimid = ? AND userid = ?';
    $score = $DB->get_field_sql($sql, [$robosimid, $userid]);
    return $score === false || $score === null ? null : (float) $score;
}

/**
 * Выставляет оценку по результату автопроверки.
 *
 * @param \stdClass $robosim запись элемента курса
 * @param int $userid ученик
 * @param float $percent результат 0…100
 * @param bool $passed задание пройдено
 * @param bool $force выставлять даже без включённой автопроверки (ручная проверка)
 * @return void
 */
function robosim_apply_grade(\stdClass $robosim, int $userid, float $percent, bool $passed, bool $force = false): void {
    if (!$robosim->grade) {
        return;
    }
    if (!$force && (empty($robosim->autograde) || !$passed)) {
        return;
    }
    $percent = max(0, min(100, $percent));
    $grade = ['userid' => $userid, 'rawgrade' => round($robosim->grade * $percent / 100, 5)];
    robosim_grade_item_update($robosim, [$grade]);
}

/**
 * Состояние завершения элемента курса.
 *
 * @param \stdClass $course курс
 * @param \stdClass $cm элемент курса
 * @param int $userid ученик
 * @param int $type тип проверки
 * @return bool
 */
function robosim_get_completion_state($course, $cm, $userid, $type) {
    global $DB;

    $robosim = $DB->get_record('robosim', ['id' => $cm->instance], '*', MUST_EXIST);
    $completion = new \completion_info($course);

    // Завершение по оценке: работа должна быть сдана и оценена.
    if ($completion->is_enabled($cm) && $cm->completiongradeitemnumber !== null) {
        $grade = robosim_best_score((int) $robosim->id, (int) $userid);
        return $grade !== null;
    }

    if ($cm->completion == COMPLETION_TRACKING_AUTOMATIC) {
        return $DB->record_exists('robosim_submissions', ['robosimid' => $robosim->id, 'userid' => $userid]);
    }

    return false;
}

/**
 * Отдаёт файлы плагина (проект учителя, вложения описания).
 *
 * @param \stdClass $course курс
 * @param \stdClass $cm элемент курса
 * @param \context $context контекст
 * @param string $filearea область файлов
 * @param array $args путь внутри области
 * @param bool $forcedownload принудительное скачивание
 * @param array $options параметры
 * @return bool
 */
function robosim_pluginfile($course, $cm, $context, $filearea, $args, $forcedownload, array $options = []) {
    if ($context->contextlevel != CONTEXT_MODULE) {
        return false;
    }
    require_login($course, true, $cm);

    $allowed = [project::FILEAREA, 'intro'];
    if (!in_array($filearea, $allowed, true)) {
        return false;
    }
    if ($filearea === project::FILEAREA && !has_capability('mod/robosim:grade', $context)) {
        return false;
    }

    $filename = array_pop($args);
    $filepath = $args ? '/' . implode('/', $args) . '/' : '/';
    $fs = get_file_storage();
    $file = $fs->get_file($context->id, 'mod_robosim', $filearea, 0, $filepath, $filename);
    if (!$file || $file->is_directory()) {
        return false;
    }

    send_stored_file($file, 0, 0, $forcedownload, $options);
}

/**
 * Что удаляется при очистке курса.
 *
 * @param \stdClass $data данные формы очистки
 * @return array
 */
function robosim_reset_userdata($data) {
    global $DB;

    $status = [];
    $componentstr = get_string('modulenameplural', 'mod_robosim');

    if (!empty($data->reset_robosim_attempts)) {
        $robosims = $DB->get_records('robosim', ['course' => $data->courseid], 'id', 'id');
        if ($robosims) {
            [$insql, $params] = $DB->get_in_or_equal(array_keys($robosims), SQL_PARAMS_QM);
            $DB->delete_records_select('robosim_submissions', "robosimid $insql", $params);
        }
        foreach ($robosims as $robosim) {
            robosim_update_grades($robosim, 0, false);
        }
        $status[] = [
            'component' => $componentstr,
            'item' => get_string('reset_attempts', 'mod_robosim'),
            'error' => false,
        ];
    }

    return $status;
}

/**
 * Описание областей файлов — нужно форме настроек и бэкапу.
 *
 * @return array
 */
function robosim_get_file_areas() {
    return [
        project::FILEAREA => get_string('projectfile', 'mod_robosim'),
    ];
}
