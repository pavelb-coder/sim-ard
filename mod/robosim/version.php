<?php
/**
 * Плагин «RoboSim» для Moodle — элемент курса (mod_robosim).
 *
 * Внутри плагина лежит сам симулятор (каталог simulator/), поэтому Moodle
 * работает без интернета и без внешних CDN: ученик открывает элемент курса,
 * собирает схему, запускает скетч и сдаёт работу, а оценка попадает в журнал.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_robosim';
$plugin->version   = 2026111501;
$plugin->requires  = 2022041900;      // Moodle 4.0 и новее.
$plugin->supported = [400, 500];      // Проверено на 4.0 … 5.x.
$plugin->maturity  = MATURITY_STABLE;
$plugin->release   = '1.0.5 (2026-11-15)';
