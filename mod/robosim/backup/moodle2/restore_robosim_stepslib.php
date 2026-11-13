<?php
/**
 * Шаги восстановления RoboSim.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Восстанавливает настройки элемента курса и (если есть) работы учеников.
 */
class restore_robosim_activity_structure_step extends restore_activity_structure_step {

    /**
     * Описание шагов.
     *
     * @return array
     */
    protected function define_structure() {
        $paths = [];
        $userinfo = $this->get_setting_value('userinfo');

        $paths[] = new restore_path_element('robosim', '/activity/robosim');
        $paths[] = new restore_path_element('robosim_submission', '/activity/robosim/submissions/submission');

        return $this->prepare_activity_structure($paths);
    }

    /**
     * Сам элемент курса.
     *
     * @param array $data данные из файла
     * @return void
     */
    protected function process_robosim($data) {
        global $DB;

        $data = (object) $data;
        $data->course = $this->get_courseid();
        $data->timemodified = $this->apply_date_offset($data->timemodified);

        $newitemid = $DB->insert_record('robosim', $data);
        $this->apply_activity_instance($newitemid);
    }

    /**
     * Сданная работа ученика.
     *
     * @param array $data данные из файла
     * @return void
     */
    protected function process_robosim_submission($data) {
        global $DB;

        $data = (object) $data;
        $data->robosimid = $this->get_new_parentid('robosim');
        $data->userid = $this->get_mappingid('user', $data->userid);
        if (!$data->userid) {
            return;
        }
        $data->timecreated = $this->apply_date_offset($data->timecreated);
        $data->timemodified = $this->apply_date_offset($data->timemodified);

        $DB->insert_record('robosim_submissions', $data);
    }

    /**
     * Файлы после восстановления структуры.
     *
     * @return void
     */
    protected function after_execute() {
        $this->add_related_files('mod_robosim', 'intro', null);
        $this->add_related_files('mod_robosim', 'project', null);
    }
}
