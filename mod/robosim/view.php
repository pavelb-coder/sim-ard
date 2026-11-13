<?php
/**
 * Страница элемента курса: симулятор, задание и сдача работы.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/robosim/lib.php');

use mod_robosim\local\project;

$id = required_param('id', PARAM_INT);
$submissionid = optional_param('submission', 0, PARAM_INT);

$cm = get_coursemodule_from_id('robosim', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$robosim = $DB->get_record('robosim', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/robosim:view', $context);

$PAGE->set_url('/mod/robosim/view.php', ['id' => $cm->id]);
$PAGE->set_title(format_string($robosim->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->add_body_class('mod-robosim-page');

// Журнал: кто и когда открыл элемент курса.
$event = \mod_robosim\event\course_module_viewed::create([
    'objectid' => $robosim->id,
    'context' => $context,
]);
$event->add_record_snapshot('course', $course);
$event->add_record_snapshot('robosim', $robosim);
$event->trigger();

$completion = new completion_info($course);
$completion->set_module_viewed($cm);

$cangrade = has_capability('mod/robosim:grade', $context);
$cansubmit = has_capability('mod/robosim:submit', $context);
$isstaff = has_capability('mod/robosim:viewreports', $context);

// ------------------------------------------------------------------ проект ----
$viewingsubmission = null;
if ($submissionid) {
    // Просмотр чужой работы — только тому, кто проверяет.
    if (!$cangrade) {
        throw new moodle_exception('nopermissions', 'error', '', get_string('grade'));
    }
    $viewingsubmission = $DB->get_record('robosim_submissions',
        ['id' => $submissionid, 'robosimid' => $robosim->id], '*', MUST_EXIST);
}

if ($viewingsubmission) {
    $project = project::normalise((string) $viewingsubmission->schematic);
    $project = $project ?: ['schematic' => ['parts' => [], 'wires' => []], 'code' => ''];
    $project['code'] = (string) $viewingsubmission->code;
    $project['token'] = project::encode_token($project['schematic'], $project['code']);
    $project['source'] = 'submission';
    $project['task'] = '';
} else {
    $project = project::instance_project($robosim, $context);
}

// ---------------------------------------------------------------- попытки ----
$attempts = project::count_attempts((int) $robosim->id, (int) $USER->id);
$maxattempts = (int) $robosim->maxattempts;
$attemptsleft = $maxattempts ? max(0, $maxattempts - $attempts) : null;
$maxreached = $maxattempts && $attempts >= $maxattempts && !$isstaff;
$last = project::last_attempt((int) $robosim->id, (int) $USER->id);
$best = robosim_best_score((int) $robosim->id, (int) $USER->id);

$simulatorurl = project::simulator_url();
$builtinurl = (new moodle_url('/mod/robosim/simulator/index.html'))->out(false);
$external = rtrim($simulatorurl, '/') !== rtrim($builtinurl, '/');

$PAGE->requires->css(new moodle_url('/mod/robosim/styles.css'));
$PAGE->requires->js(new moodle_url('/mod/robosim/js/player.js'));

$templatecontext = [
    'cmid' => $cm->id,
    'name' => format_string($robosim->name),
    'intro' => format_module_intro('robosim', $robosim, $cm->id),
    'hasintro' => trim(strip_tags((string) $robosim->intro)) !== '',
    'prompt' => $robosim->prompt ? format_text($robosim->prompt, FORMAT_HTML,
        ['context' => $context, 'noclean' => true]) : '',
    'hasprompt' => trim(strip_tags((string) $robosim->prompt)) !== '',
    'playerurl' => project::player_url((string) $project['token']),
    'playerurlplain' => $simulatorurl,
    'external' => $external,
    'task' => (string) ($project['task'] ?? ''),
    'hastask' => (string) ($project['task'] ?? '') !== '',
    'source' => project::describe_source((string) ($project['source'] ?? 'empty')),
    'sesskey' => sesskey(),
    'wwwroot' => $CFG->wwwroot,
    'cansubmit' => $cansubmit && !$maxreached && !$external && !$viewingsubmission,
    'cangrade' => $cangrade,
    'isstaff' => $isstaff,
    'autograde' => (bool) $robosim->autograde,
    'maxgrade' => (float) $robosim->grade,
    'hasgrade' => (bool) $robosim->grade,
    'reporturl' => (new moodle_url('/mod/robosim/report.php', ['id' => $cm->id]))->out(false),
    'attempts' => $attempts,
    'maxattempts' => $maxattempts,
    'attemptsleft' => $attemptsleft === null ? '' : (string) $attemptsleft,
    'limited' => (bool) $maxattempts,
    'maxreached' => $maxreached,
    'best' => $best === null ? '' : format_float($best, 0),
    'hasbest' => $best !== null,
    'lasttime' => $last ? userdate((int) $last->timecreated, get_string('strftimedatetimeshort', 'langconfig')) : '',
    'lastscore' => $last ? (string) (int) $last->score : '',
    'lastpassed' => $last ? (bool) $last->passed : false,
    'viewingsubmission' => $viewingsubmission ? [
        'user' => fullname($DB->get_record('user', ['id' => $viewingsubmission->userid], '*', MUST_EXIST)),
        'attempt' => (int) $viewingsubmission->attempt,
        'score' => (int) $viewingsubmission->score,
        'passed' => (bool) $viewingsubmission->passed,
        'time' => userdate((int) $viewingsubmission->timecreated,
            get_string('strftimedatetimeshort', 'langconfig')),
        'backurl' => (new moodle_url('/mod/robosim/view.php', ['id' => $cm->id]))->out(false),
    ] : null,
];

echo $OUTPUT->header();

echo $OUTPUT->render_from_template('mod_robosim/view', $templatecontext);

echo $OUTPUT->footer();
