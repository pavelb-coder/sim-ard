<?php
/**
 * Восстановление элемента курса RoboSim из резервной копии.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/robosim/backup/moodle2/restore_robosim_stepslib.php');

/**
 * Задача восстановления.
 */
class restore_robosim_activity_task extends restore_activity_task {

    /**
     * Собственных настроек нет.
     *
     * @return void
     */
    protected function define_my_settings() {
    }

    /**
     * Шаги восстановления.
     *
     * @return void
     */
    protected function define_my_steps() {
        $this->add_step(new restore_robosim_activity_structure_step('robosim_structure', 'robosim.xml'));
    }

    /**
     * Области файлов, которые нужно восстановить.
     *
     * @return array
     */
    public static function define_decode_contents() {
        return [
            new restore_decode_content('robosim', ['intro', 'prompt'], 'robosim'),
        ];
    }

    /**
     * Правила раскодирования ссылок.
     *
     * @return array
     */
    public static function define_decode_rules() {
        return [
            new restore_decode_rule('ROBOSIMVIEW', '/mod/robosim/view.php?id=$1', 'course_module'),
            new restore_decode_rule('ROBOSIMREPORT', '/mod/robosim/report.php?id=$1', 'course_module'),
        ];
    }

    /**
     * Пересчёт оценок после восстановления.
     *
     * @return void
     */
    protected function after_restore() {
        global $DB;
        require_once($CFG->dirroot . '/mod/robosim/lib.php');

        if ($robosim = $DB->get_record('robosim', ['id' => $this->get_activityid()])) {
            robosim_grade_item_update($robosim);
            robosim_update_grades($robosim);
        }
    }
}
