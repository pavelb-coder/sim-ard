<?php
/**
 * Отчёт по сданным работам и выставление оценок.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once($CFG->dirroot . '/mod/robosim/lib.php');

use mod_robosim\local\project;

$id = required_param('id', PARAM_INT);

$cm = get_coursemodule_from_id('robosim', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$robosim = $DB->get_record('robosim', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/robosim:viewreports', $context);

$url = new moodle_url('/mod/robosim/report.php', ['id' => $cm->id]);

// ------------------------------------------------------- ручная проверка ----
$action = optional_param('action', '', PARAM_ALPHA);
$submissionid = optional_param('submission', 0, PARAM_INT);
if ($action === 'grade' && $submissionid) {
    require_sesskey();
    require_capability('mod/robosim:grade', $context);

    $submission = $DB->get_record('robosim_submissions',
        ['id' => $submissionid, 'robosimid' => $robosim->id], '*', MUST_EXIST);
    $points = unformat_float(optional_param('points', 0, PARAM_RAW));
    $points = max(0, min((float) $robosim->grade, (float) $points));

    $grade = [(int) $submission->userid => (object) ['userid' => (int) $submission->userid, 'rawgrade' => $points]];
    robosim_grade_item_update($robosim, $grade);

    $DB->set_field('robosim_submissions', 'status', 'graded', ['id' => $submission->id]);
    $DB->set_field('robosim_submissions', 'grade', $points, ['id' => $submission->id]);
    $DB->set_field('robosim_submissions', 'timemodified', time(), ['id' => $submission->id]);

    redirect($url, get_string('gradesaved', 'mod_robosim'), null, \core\output\notification::NOTIFY_SUCCESS);
}

if ($action === 'delete' && $submissionid) {
    require_sesskey();
    require_capability('mod/robosim:grade', $context);
    $DB->delete_records('robosim_submissions', ['id' => $submissionid, 'robosimid' => $robosim->id]);
    robosim_update_grades($robosim);
    redirect($url, get_string('deletedattempt', 'mod_robosim'), null, \core\output\notification::NOTIFY_SUCCESS);
}

// ---------------------------------------------------------------- данные ----
$sql = "SELECT s.*, u.firstname, u.lastname, u.firstnamephonetic, u.lastnamephonetic,
               u.middlename, u.alternatename, u.email, u.picture, u.imagealt
          FROM {robosim_submissions} s
          JOIN {user} u ON u.id = s.userid
         WHERE s.robosimid = ?
      ORDER BY u.lastname, u.firstname, s.attempt DESC";
$submissions = $DB->get_records_sql($sql, [$robosim->id]);

$PAGE->set_url($url);
$PAGE->set_title(format_string($robosim->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->requires->css(new moodle_url('/mod/robosim/styles.css'));

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('reportfor', 'mod_robosim', format_string($robosim->name)));

echo html_writer::div(html_writer::link(new moodle_url('/mod/robosim/view.php', ['id' => $cm->id]),
    get_string('backtoactivity', 'mod_robosim'), ['class' => 'btn btn-outline-secondary btn-sm mb-3']));

if (!$submissions) {
    echo $OUTPUT->notification(get_string('nosubmissions', 'mod_robosim'), 'info');
    echo $OUTPUT->footer();
    exit;
}

$attempts = [];
foreach ($submissions as $submission) {
    $attempts[$submission->userid][] = $submission;
}

$table = new html_table();
$table->head = [
    get_string('student', 'mod_robosim'),
    get_string('attempts', 'mod_robosim'),
    get_string('bestresult', 'mod_robosim'),
    get_string('lastattempt', 'mod_robosim'),
    get_string('status', 'mod_robosim'),
    get_string('grade', 'mod_robosim'),
    get_string('actions', 'mod_robosim'),
];
$table->attributes['class'] = 'generaltable robosim-report';

foreach ($attempts as $userid => $list) {
    $user = $DB->get_record('user', ['id' => $userid], '*', MUST_EXIST);
    // get_records_sql возвращает записи с ключом по id, поэтому первую берём через reset():
    // сортировка attempt DESC — это последняя попытка ученика.
    $last = reset($list);
    $best = 0;
    foreach ($list as $item) {
        $best = max($best, (int) $item->score);
    }

    $viewurl = new moodle_url('/mod/robosim/view.php', ['id' => $cm->id, 'submission' => $last->id]);
    $downloadurl = new moodle_url('/mod/robosim/download.php', ['id' => $cm->id, 'submission' => $last->id]);

    $statusitems = [];
    foreach ($list as $item) {
        $badge = $item->passed
            ? html_writer::span(get_string('passed', 'mod_robosim'), 'badge bg-success robosim-badge')
            : html_writer::span(get_string('failed', 'mod_robosim'), 'badge bg-secondary robosim-badge');
        $statusitems[] = html_writer::div(
            html_writer::link($viewurl->out(false), get_string('attempt', 'mod_robosim') . ' ' . $item->attempt)
            . ' — ' . (int) $item->score . '% ' . $badge
            . ' ' . html_writer::span(userdate((int) $item->timecreated,
                get_string('strftimedatetimeshort', 'langconfig')), 'small text-muted'),
            'robosim-attempt'
        );
    }

    $gradecell = '';
    if ($robosim->grade) {
        $form = html_writer::start_tag('form', ['method' => 'post', 'action' => $url->out(false),
            'class' => 'robosim-gradeform form-inline']);
        $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'id', 'value' => $cm->id]);
        $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'action', 'value' => 'grade']);
        $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'submission', 'value' => $last->id]);
        $form .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
        $form .= html_writer::empty_tag('input', ['type' => 'number', 'name' => 'points', 'step' => '0.5',
            'min' => '0', 'max' => $robosim->grade, 'value' => $last->grade !== null ? $last->grade : '',
            'class' => 'form-control form-control-sm robosim-points', 'aria-label' => get_string('grade', 'mod_robosim')]);
        $form .= html_writer::tag('span', ' / ' . format_float((float) $robosim->grade, 2), ['class' => 'small']);
        $form .= html_writer::empty_tag('input', ['type' => 'submit', 'class' => 'btn btn-sm btn-primary ms-2',
            'value' => get_string('savegrade', 'mod_robosim')]);
        $form .= html_writer::end_tag('form');
        $gradecell = $form;
    }

    $actions = html_writer::link($viewurl, get_string('openwork', 'mod_robosim'),
        ['class' => 'btn btn-sm btn-outline-primary me-1']);
    $actions .= html_writer::link($downloadurl, get_string('downloadwork', 'mod_robosim'),
        ['class' => 'btn btn-sm btn-outline-secondary me-1']);
    $deleteurl = new moodle_url('/mod/robosim/report.php',
        ['id' => $cm->id, 'action' => 'delete', 'submission' => $last->id, 'sesskey' => sesskey()]);
    $actions .= html_writer::link($deleteurl, get_string('deleteattempt', 'mod_robosim'),
        ['class' => 'btn btn-sm btn-outline-danger', 'onclick' => 'return confirm("'
            . get_string('confirmdeleteattempt', 'mod_robosim') . '");']);

    $table->data[] = [
        html_writer::div(fullname($user), 'robosim-student'),
        count($list),
        $best . '%',
        userdate((int) $last->timecreated, get_string('strftimedatetimeshort', 'langconfig')),
        html_writer::div(implode('', $statusitems)),
        $gradecell,
        $actions,
    ];
}

echo html_writer::table($table);
echo $OUTPUT->footer();
