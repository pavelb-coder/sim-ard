<?php
/**
 * Структура резервной копии RoboSim.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Описывает, что именно попадает в резервную копию.
 */
class backup_robosim_activity_structure_step extends backup_activity_structure_step {

    /**
     * Собирает дерево элементов.
     *
     * @return backup_nested_element
     */
    protected function define_structure() {
        $userinfo = $this->get_setting_value('userinfo');

        $robosim = new backup_nested_element('robosim', ['id'], [
            'name', 'intro', 'introformat', 'preset', 'customproject', 'prompt', 'promptformat',
            'autograde', 'maxattempts', 'grade', 'timemodified',
        ]);

        $submissions = new backup_nested_element('submissions');
        $submission = new backup_nested_element('submission', ['id'], [
            'userid', 'attempt', 'schematic', 'code', 'score', 'passed', 'checks', 'status', 'grade',
            'timecreated', 'timemodified',
        ]);

        $robosim->add_child($submissions);
        $submissions->add_child($submission);

        $robosim->set_source_table('robosim', ['id' => backup::VAR_ACTIVITYID]);

        // Работы учеников копируются только при полном копировании с данными пользователей.
        if ($userinfo) {
            $submission->set_source_table('robosim_submissions', ['robosimid' => backup::VAR_PARENTID]);
            $submission->annotate_ids('user', 'userid');
        }

        $robosim->annotate_files('mod_robosim', 'intro', null);
        $robosim->annotate_files('mod_robosim', 'project', null);

        return $this->prepare_activity_structure($robosim);
    }
}
