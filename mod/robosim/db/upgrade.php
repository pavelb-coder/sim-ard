<?php
/**
 * Обновление плагина RoboSim с предыдущих версий.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Стандартная точка входа обновления.
 *
 * @param int $oldversion версия установленного плагина
 * @return bool
 */
function xmldb_robosim_upgrade($oldversion) {
    global $DB;

    $dbman = $DB->get_manager();

    // Заготовка под будущие версии: 2026111200 — первая.
    if ($oldversion < 2026111200) {
        upgrade_mod_savepoint(true, 2026111200, 'robosim');
    }

    return true;
}
