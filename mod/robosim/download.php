<?php
/**
 * Скачивание сданной работы учителем (файл проекта RoboSim).
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/robosim/lib.php');

use mod_robosim\local\project;

$id = required_param('id', PARAM_INT);
$submissionid = required_param('submission', PARAM_INT);

$cm = get_coursemodule_from_id('robosim', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$robosim = $DB->get_record('robosim', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);

$submission = $DB->get_record('robosim_submissions',
    ['id' => $submissionid, 'robosimid' => $robosim->id], '*', MUST_EXIST);

// Свою работу может скачать ученик, чужую — только проверяющий.
$isowner = (int) $submission->userid === (int) $USER->id;
if (!$isowner) {
    require_capability('mod/robosim:viewreports', $context);
}

$user = $DB->get_record('user', ['id' => $submission->userid], '*', MUST_EXIST);
$payload = [
    'app' => 'robosim',
    'version' => 2,
    'task' => $robosim->preset,
    'attempt' => (int) $submission->attempt,
    'score' => (int) $submission->score,
    'passed' => (bool) $submission->passed,
    'owner' => fullname($user),
    'submitted' => userdate((int) $submission->timecreated),
    'schematic' => json_decode((string) $submission->schematic, true) ?: ['parts' => [], 'wires' => []],
    'code' => (string) $submission->code,
];

$filename = clean_filename(sprintf('robosim-%s-%s-%d.json',
    $robosim->name, fullname($user), $submission->attempt));

send_file(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
    $filename, 0, 0, true, true, 'application/json');
