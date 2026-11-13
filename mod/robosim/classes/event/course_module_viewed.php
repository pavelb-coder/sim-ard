<?php
/**
 * Событие «элемент курса открыт».
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_robosim\event;

defined('MOODLE_INTERNAL') || die();

/**
 * Записывается при открытии страницы элемента курса.
 */
class course_module_viewed extends \core\event\course_module_viewed {

    /**
     * Параметры события.
     *
     * @return void
     */
    protected function init() {
        $this->data['crud'] = 'r';
        $this->data['edulevel'] = self::LEVEL_PARTICIPATING;
        $this->data['objecttable'] = 'robosim';
    }

    /**
     * Соответствие id при восстановлении из резервной копии.
     *
     * @return array
     */
    public static function get_objectid_mapping() {
        return ['db' => 'robosim', 'restore' => 'robosim'];
    }
}
