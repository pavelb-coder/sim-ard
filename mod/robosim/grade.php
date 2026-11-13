<?php
/**
 * Переход из журнала оценок к элементу курса.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');

$id = required_param('id', PARAM_INT);
$itemnumber = optional_param('itemnumber', 0, PARAM_INT);
$userid = optional_param('userid', 0, PARAM_INT);

$cm = get_coursemodule_from_id('robosim', $id, 0, false, MUST_EXIST);

$params = ['id' => $cm->id];
if ($userid) {
    $params['userid'] = $userid;
}

// Проверяющему удобнее открыть отчёт, ученику — сам симулятор.
$context = context_module::instance($cm->id);
if (has_capability('mod/robosim:viewreports', $context)) {
    redirect(new moodle_url('/mod/robosim/report.php', $params));
}

redirect(new moodle_url('/mod/robosim/view.php', $params));
