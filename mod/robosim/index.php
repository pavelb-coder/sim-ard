<?php
/**
 * Список всех симуляторов курса.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');

use mod_robosim\local\project;

$id = required_param('id', PARAM_INT);

$course = $DB->get_record('course', ['id' => $id], '*', MUST_EXIST);
require_course_login($course, true);

$PAGE->set_url('/mod/robosim/index.php', ['id' => $id]);
$PAGE->set_title(format_string($course->fullname));
$PAGE->set_heading(format_string($course->fullname));

$strname = get_string('modulenameplural', 'mod_robosim');

$robosims = get_all_instances_in_course('robosim', $course);

echo $OUTPUT->header();
echo $OUTPUT->heading($strname);

if (!$robosims) {
    notice(get_string('thereareno', 'moodle', $strname),
        new moodle_url('/course/view.php', ['id' => $course->id]));
}

$table = new html_table();
$table->head = [get_string('name'), get_string('startsfrom', 'mod_robosim')];
$table->align = ['left', 'left'];

foreach ($robosims as $robosim) {
    $url = new moodle_url('/mod/robosim/view.php', ['id' => $robosim->coursemodule]);
    $table->data[] = [
        html_writer::link($url, format_string($robosim->name)),
        project::describe_source((string) $robosim->preset),
    ];
}

echo html_writer::table($table);
echo $OUTPUT->footer();
