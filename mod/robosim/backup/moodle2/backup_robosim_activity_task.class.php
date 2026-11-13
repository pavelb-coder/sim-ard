<?php
/**
 * Резервное копирование элемента курса RoboSim.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/robosim/backup/moodle2/backup_robosim_stepslib.php');

/**
 * Задача резервного копирования: настройки элемента курса и файл проекта.
 */
class backup_robosim_activity_task extends backup_activity_task {

    /**
     * Собственных настроек у плагина нет.
     *
     * @return void
     */
    protected function define_my_settings() {
    }

    /**
     * Шаги копирования.
     *
     * @return void
     */
    protected function define_my_steps() {
        $this->add_step(new backup_robosim_activity_structure_step('robosim_structure', 'robosim.xml'));
    }

    /**
     * Ссылки на элемент курса внутри текста курса.
     *
     * @param string $content текст
     * @return string
     */
    public static function encode_content_links($content) {
        global $CFG;

        $base = preg_quote($CFG->wwwroot . '/mod/robosim', '#');

        $content = preg_replace("#({$base}/view\.php\?id=)([0-9]+)#", '$@ROBOSIMVIEW*$2@$', $content);
        $content = preg_replace("#({$base}/report\.php\?id=)([0-9]+)#", '$@ROBOSIMREPORT*$2@$', $content);

        return $content;
    }
}
