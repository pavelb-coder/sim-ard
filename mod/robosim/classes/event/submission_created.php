<?php
/**
 * Событие «ученик сдал работу».
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_robosim\event;

defined('MOODLE_INTERNAL') || die();

/**
 * Срабатывает в submit.php после сохранения попытки.
 */
class submission_created extends \core\event\base {

    /**
     * Параметры события.
     *
     * @return void
     */
    protected function init() {
        $this->data['crud'] = 'c';
        $this->data['edulevel'] = self::LEVEL_PARTICIPATING;
        $this->data['objecttable'] = 'robosim_submissions';
    }

    /**
     * Название события.
     *
     * @return string
     */
    public static function get_name() {
        return get_string('event_submission_created', 'mod_robosim');
    }

    /**
     * Описание для журнала событий.
     *
     * @return string
     */
    public function get_description() {
        $attempt = isset($this->other['attempt']) ? $this->other['attempt'] : 1;
        $score = isset($this->other['score']) ? $this->other['score'] : 0;
        return "The user with id '{$this->userid}' submitted attempt {$attempt} " .
            "of the RoboSim activity with course module id '{$this->contextinstanceid}' " .
            "with result {$score}%.";
    }

    /**
     * Ссылка на отчёт по работам.
     *
     * @return \moodle_url
     */
    public function get_url() {
        return new \moodle_url('/mod/robosim/report.php', ['id' => $this->contextinstanceid]);
    }

    /**
     * Соответствие id при восстановлении.
     *
     * @return array
     */
    public static function get_objectid_mapping() {
        return ['db' => 'robosim_submissions', 'restore' => 'robosim_submissions'];
    }
}
