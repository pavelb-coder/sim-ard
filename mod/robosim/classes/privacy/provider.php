<?php
/**
 * Политика конфиденциальности плагина RoboSim.
 *
 * Плагин хранит сданные работы: схему и скетч ученика, результат
 * автопроверки и время сдачи. Всё это привязано к пользователю и к
 * элементу курса, поэтому данные можно экспортировать и удалить по
 * стандартному запросу GDPR.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_robosim\privacy;

defined('MOODLE_INTERNAL') || die();

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\transform;
use core_privacy\local\request\writer;

/**
 * Провайдер данных: описания, экспорт и удаление работ ученика.
 */
class provider implements
    \core_privacy\local\metadata\provider,
    \core_privacy\local\request\core_user_data_provider {

    /**
     * Подгружает функции плагина (нужны для пересчёта оценок).
     *
     * @return void
     */
    private static function load_lib(): void {
        global $CFG;
        require_once($CFG->dirroot . '/mod/robosim/lib.php');
    }

    /**
     * Какие данные хранит плагин.
     *
     * @param collection $collection коллекция описаний
     * @return collection
     */
    public static function get_metadata(collection $collection): collection {
        $collection->add_database_table('robosim_submissions', [
            'userid' => 'privacy:metadata:robosim_submissions:userid',
            'attempt' => 'privacy:metadata:robosim_submissions:attempt',
            'schematic' => 'privacy:metadata:robosim_submissions:schematic',
            'code' => 'privacy:metadata:robosim_submissions:code',
            'score' => 'privacy:metadata:robosim_submissions:score',
            'checks' => 'privacy:metadata:robosim_submissions:checks',
            'timecreated' => 'privacy:metadata:robosim_submissions:timecreated',
        ], 'privacy:metadata:robosim_submissions');

        return $collection;
    }

    /**
     * В каких контекстах есть данные пользователя.
     *
     * @param int $userid id пользователя
     * @return contextlist
     */
    public static function get_contexts_for_userid(int $userid): contextlist {
        $sql = "SELECT ctx.id
                  FROM {context} ctx
                  JOIN {course_modules} cm ON cm.id = ctx.instanceid AND ctx.contextlevel = :modulelevel
                  JOIN {robosim} r ON r.id = cm.instance
                  JOIN {robosim_submissions} s ON s.robosimid = r.id
                 WHERE s.userid = :userid";
        $contextlist = new contextlist();
        $contextlist->add_from_sql($sql, ['modulelevel' => CONTEXT_MODULE, 'userid' => $userid]);
        return $contextlist;
    }

    /**
     * Экспорт работ пользователя.
     *
     * @param approved_contextlist $contextlist список контекстов
     * @return void
     */
    public static function export_user_data(approved_contextlist $contextlist) {
        global $DB;

        $userid = (int) $contextlist->get_user()->id;
        foreach ($contextlist->get_contexts() as $context) {
            if ($context->contextlevel != CONTEXT_MODULE) {
                continue;
            }
            $robosim = $DB->get_record_sql(
                "SELECT r.*
                   FROM {course_modules} cm
                   JOIN {robosim} r ON r.id = cm.instance
                  WHERE cm.id = ?", [$context->instanceid]);
            if (!$robosim) {
                continue;
            }
            $submissions = $DB->get_records('robosim_submissions',
                ['robosimid' => $robosim->id, 'userid' => $userid], 'attempt ASC');
            if (!$submissions) {
                continue;
            }
            $data = [];
            foreach ($submissions as $submission) {
                $data[] = (object) [
                    'attempt' => (int) $submission->attempt,
                    'score' => (int) $submission->score,
                    'passed' => transform::yesno((bool) $submission->passed),
                    'timecreated' => transform::datetime((int) $submission->timecreated),
                    'schematic' => (string) $submission->schematic,
                    'code' => (string) $submission->code,
                ];
            }
            writer::with_context($context)->export_data(
                [get_string('privacy:submissions', 'mod_robosim')],
                (object) ['submissions' => $data]
            );
        }
    }

    /**
     * Удаление всех работ в контексте.
     *
     * @param \context $context контекст
     * @return void
     */
    public static function delete_data_for_all_users_in_context(\context $context) {
        global $DB;
        self::load_lib();

        if ($context->contextlevel != CONTEXT_MODULE) {
            return;
        }
        $robosim = $DB->get_record_sql(
            "SELECT r.*
               FROM {course_modules} cm
               JOIN {robosim} r ON r.id = cm.instance
              WHERE cm.id = ?", [$context->instanceid]);
        if (!$robosim) {
            return;
        }
        $DB->delete_records('robosim_submissions', ['robosimid' => $robosim->id]);
        robosim_update_grades($robosim);
    }

    /**
     * Удаление работ одного пользователя.
     *
     * @param approved_contextlist $contextlist список контекстов
     * @return void
     */
    public static function delete_data_for_user(approved_contextlist $contextlist) {
        global $DB;
        self::load_lib();

        $userid = (int) $contextlist->get_user()->id;
        foreach ($contextlist->get_contexts() as $context) {
            if ($context->contextlevel != CONTEXT_MODULE) {
                continue;
            }
            $robosim = $DB->get_record_sql(
                "SELECT r.*
                   FROM {course_modules} cm
                   JOIN {robosim} r ON r.id = cm.instance
                  WHERE cm.id = ?", [$context->instanceid]);
            if (!$robosim) {
                continue;
            }
            $DB->delete_records('robosim_submissions', ['robosimid' => $robosim->id, 'userid' => $userid]);
            robosim_update_grades($robosim, $userid);
        }
    }
}
