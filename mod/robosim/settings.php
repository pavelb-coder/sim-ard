<?php
/**
 * Общие настройки плагина RoboSim (администрирование сайта).
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

use mod_robosim\local\project;

if ($ADMIN->fulltree) {

    $settings->add(new admin_setting_heading('mod_robosim/heading',
        get_string('settingsheading', 'mod_robosim'),
        get_string('settingsheading_desc', 'mod_robosim')));

    $settings->add(new admin_setting_configselect('mod_robosim/defaultexample',
        get_string('defaultexample', 'mod_robosim'),
        get_string('defaultexample_desc', 'mod_robosim'),
        'blink',
        project::example_menu()));

    $settings->add(new admin_setting_configcheckbox('mod_robosim/allowexternal',
        get_string('allowexternal', 'mod_robosim'),
        get_string('allowexternal_desc', 'mod_robosim'),
        0));

    $settings->add(new admin_setting_configtext('mod_robosim/simurl',
        get_string('simurl', 'mod_robosim'),
        get_string('simurl_desc', 'mod_robosim'),
        '', PARAM_URL));

    // Короткая справка о сборке симулятора внутри плагина.
    $settings->add(new admin_setting_heading('mod_robosim/abouthow',
        get_string('aboutheading', 'mod_robosim'),
        get_string('aboutheading_desc', 'mod_robosim', count(project::examples()))));
}
