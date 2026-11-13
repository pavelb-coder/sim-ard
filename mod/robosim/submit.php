<?php
/**
 * Приём сданной работы из симулятора (AJAX).
 *
 * Скрипт получает схему, скетч и результат автопроверки задания, складывает
 * попытку в robosim_submissions, при включённой автопроверке выставляет оценку
 * и отвечает JSON-ом, который страница показывает ученику.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define('AJAX_SCRIPT', true);

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/robosim/lib.php');

use mod_robosim\local\project;

$id = required_param('id', PARAM_INT);
$action = optional_param('action', 'submit', PARAM_ALPHA);
$rawschematic = optional_param('schematic', '', PARAM_RAW);
$code = optional_param('code', '', PARAM_RAW);
$score = optional_param('score', 0, PARAM_INT);
$passed = optional_param('passed', 0, PARAM_BOOL);
$checks = optional_param('checks', '', PARAM_RAW);

$cm = get_coursemodule_from_id('robosim', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$robosim = $DB->get_record('robosim', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
require_sesskey();

$context = context_module::instance($cm->id);
require_capability('mod/robosim:submit', $context);

/**
 * Отправляет JSON и завершает работу.
 *
 * @param array $data данные ответа
 * @return void
 */
function robosim_json_response(array $data): void {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$project = project::normalise($rawschematic);
if (!$project) {
    robosim_json_response(['error' => true, 'message' => get_string('error_badproject', 'mod_robosim')]);
}
if (core_text::strlen($code) > 200000 || strlen($rawschematic) > project::MAX_JSON) {
    robosim_json_response(['error' => true, 'message' => get_string('error_toolong', 'mod_robosim')]);
}

// Подробности проверки приходят строкой JSON: битый или огромный ответ не храним.
$checks = trim($checks);
if ($checks !== '') {
    $decoded = json_decode($checks, true);
    $checks = is_array($decoded) ? json_encode($decoded, JSON_UNESCAPED_UNICODE) : '[]';
    if (core_text::strlen($checks) > 20000) {
        $checks = '[]';
    }
}

$score = max(0, min(100, $score));
$passed = $passed && $score >= 100;
$attempt = project::count_attempts((int) $robosim->id, (int) $USER->id) + 1;

// Ограничение на число попыток: проверяем на сервере, а не только в интерфейсе.
$maxattempts = (int) $robosim->maxattempts;
if ($maxattempts && $attempt > $maxattempts && !has_capability('mod/robosim:grade', $context)) {
    robosim_json_response(['error' => true, 'message' => get_string('attemptsused', 'mod_robosim')]);
}

$now = time();
$record = (object) [
    'robosimid' => $robosim->id,
    'userid' => $USER->id,
    'attempt' => $attempt,
    'schematic' => json_encode($project['schematic'], JSON_UNESCAPED_UNICODE),
    'code' => $code,
    'score' => $score,
    'passed' => $passed ? 1 : 0,
    'checks' => $checks,
    'status' => 'submitted',
    'timecreated' => $now,
    'timemodified' => $now,
];

if ($action === 'check') {
    // «Проверить» ничего не записывает: ученик смотрит результат до сдачи.
    robosim_json_response([
        'saved' => false,
        'score' => $score,
        'passed' => $passed,
        'grade' => null,
        'attemptsleft' => $maxattempts ? max(0, $maxattempts - $attempt + 1) : null,
    ]);
}

$record->id = $DB->insert_record('robosim_submissions', $record);

// Оценка в журнал: при автопроверке — сразу и по лучшей попытке,
// иначе работу проверит учитель (в отчёте).
$best = robosim_best_score((int) $robosim->id, (int) $USER->id);
$best = $best === null ? (float) $score : $best;
robosim_apply_grade($robosim, (int) $USER->id, $best, $best >= 100);

$grade = null;
if ($robosim->grade && !empty($robosim->autograde) && $best >= 100) {
    $grade = round($robosim->grade * $best / 100, 2);
    $DB->set_field('robosim_submissions', 'status', 'graded', ['id' => $record->id]);
    $DB->set_field('robosim_submissions', 'grade', $grade, ['id' => $record->id]);
}

$event = \mod_robosim\event\submission_created::create([
    'objectid' => $record->id,
    'context' => $context,
    'other' => ['robosimid' => $robosim->id, 'attempt' => $attempt, 'score' => $score],
]);
$event->add_record_snapshot('course', $course);
$event->trigger();

$completion = new completion_info($course);
$completion->update_state($cm, COMPLETION_UNKNOWN, (int) $USER->id);

robosim_json_response([
    'saved' => true,
    'score' => $score,
    'passed' => $passed,
    'grade' => $grade,
    'attempt' => $attempt,
    'attemptsleft' => $maxattempts ? max(0, $maxattempts - $attempt) : null,
]);
