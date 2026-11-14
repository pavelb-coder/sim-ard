<?php
/**
 * Форма добавления и редактирования элемента курса RoboSim.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/course/moodleform_mod.php');
require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->dirroot . '/mod/robosim/lib.php');

use mod_robosim\local\project;

/**
 * Настройки элемента курса: что открывать ученику и как оценивать.
 */
class mod_robosim_mod_form extends moodleform_mod {

    /**
     * Строит форму.
     *
     * @return void
     */
    public function definition() {
        global $CFG, $COURSE;

        $mform = $this->_form;

        $mform->addElement('header', 'general', get_string('general', 'form'));

        $mform->addElement('text', 'name', get_string('name'), ['size' => '64']);
        $mform->setType('name', PARAM_TEXT);
        $mform->addRule('name', null, 'required', null, 'client');
        $mform->addRule('name', get_string('maximumchars', '', 255), 'maxlength', 255, 'client');

        $this->standard_intro_elements(get_string('description', 'mod_robosim'));

        // ------------------------------------------------ что открывать ----
        $mform->addElement('header', 'robosimheader', get_string('simulator', 'mod_robosim'));

        $mform->addElement('selectgroups', 'preset', get_string('preset', 'mod_robosim'), $this->preset_groups());
        $mform->setDefault('preset', 'example:blink');
        $mform->addHelpButton('preset', 'preset', 'mod_robosim');

        $mform->addElement('textarea', 'customproject', get_string('customproject', 'mod_robosim'),
            ['rows' => 6, 'cols' => 80, 'wrap' => 'virtual']);
        $mform->setType('customproject', PARAM_RAW);
        $mform->addHelpButton('customproject', 'customproject', 'mod_robosim');
        $mform->hideIf('customproject', 'preset', 'neq', 'custom');

        $mform->addElement('filemanager', 'projectfile', get_string('projectfile', 'mod_robosim'), null,
            ['subdirs' => 0, 'maxfiles' => 1, 'maxbytes' => project::MAX_JSON, 'accepted_types' => ['.json', '.txt']]);
        $mform->addHelpButton('projectfile', 'projectfile', 'mod_robosim');

        $editoroptions = ['maxfiles' => 0];
        if (!empty($this->_cm->id)) {
            $editoroptions['context'] = \context_module::instance($this->_cm->id);
        }
        $mform->addElement('editor', 'prompt', get_string('prompt', 'mod_robosim'), ['rows' => 5], $editoroptions);
        $mform->setDefault('prompt', ['text' => '', 'format' => FORMAT_HTML]);
        $mform->addHelpButton('prompt', 'prompt', 'mod_robosim');
        $mform->setType('prompt', PARAM_RAW);

        // ------------------------------------------------ оценивание ----
        $mform->addElement('header', 'gradeheader', get_string('gradesettings', 'mod_robosim'));

        if (method_exists($this, 'standard_grading_coursemodule_elements')) {
            $this->standard_grading_coursemodule_elements();
        } else {
            $mform->addElement('modgrade', 'grade', get_string('grade'), false);
        }
        $mform->setDefault('grade', 100);

        $mform->addElement('advcheckbox', 'autograde', get_string('autograde', 'mod_robosim'), '');
        $mform->addHelpButton('autograde', 'autograde', 'mod_robosim');

        $mform->addElement('text', 'maxattempts', get_string('maxattempts', 'mod_robosim'), ['size' => 4]);
        $mform->setType('maxattempts', PARAM_INT);
        $mform->setDefault('maxattempts', 0);
        $mform->addHelpButton('maxattempts', 'maxattempts', 'mod_robosim');

        // ------------------------------------------------ стандартные ----
        $this->standard_coursemodule_elements();
        $this->add_action_buttons();
    }

    /**
     * Группы для выпадающего списка: примеры, задания, своя схема.
     *
     * @return array
     */
    private function preset_groups(): array {
        $examples = [];
        foreach (project::example_menu() as $id => $name) {
            $examples['example:' . $id] = $name;
        }
        $tasks = [];
        foreach (project::task_menu() as $id => $name) {
            $tasks['task:' . $id] = $name;
        }
        return [
            get_string('preset_examples', 'mod_robosim') => $examples,
            get_string('preset_tasks', 'mod_robosim') => $tasks,
            get_string('preset_custom', 'mod_robosim') => ['custom' => get_string('preset_custom_desc', 'mod_robosim')],
        ];
    }

    /**
     * Подготавливает данные для отображения в форме.
     *
     * @param \stdClass $defaultvalues значение по умолчанию
     * @return void
     */
    public function data_preprocessing(&$defaultvalues, $mform = null) {
        parent::data_preprocessing($defaultvalues);

        $draftitemid = file_get_submitted_draft_itemid('projectfile');
        if (!empty($this->_cm->id)) {
            $context = \context_module::instance($this->_cm->id);
            file_prepare_draft_area($draftitemid, $context->id, 'mod_robosim', project::FILEAREA, 0,
                ['subdirs' => 0, 'maxfiles' => 1]);
        }
        $defaultvalues['projectfile'] = $draftitemid;

        $defaultvalues['prompt'] = [
            'text' => $defaultvalues['prompt'] ?? '',
            'format' => FORMAT_HTML,
        ];

        if (empty($defaultvalues['preset'])) {
            $defaultvalues['preset'] = 'example:blink';
        }
    }

    /**
     * Проверяет введённые данные.
     *
     * @param array $data данные
     * @param array $files файлы
     * @return array ошибки
     */
    public function validation($data, $files) {
        $errors = parent::validation($data, $files);

        if (($data['preset'] ?? '') === 'custom') {
            $hasfile = $this->has_draft_file((int) ($data['projectfile'] ?? 0));
            $hastext = trim((string) ($data['customproject'] ?? '')) !== '';
            if ($hastext && !project::normalise((string) $data['customproject'])) {
                $errors['customproject'] = get_string('error_badproject', 'mod_robosim');
            }
            if (!$hasfile && !$hastext) {
                $errors['customproject'] = get_string('error_noproject', 'mod_robosim');
            }
        }

        return $errors;
    }

    /**
     * Есть ли файл в черновике файлового менеджера.
     *
     * @param int $draftid id черновика
     * @return bool
     */
    private function has_draft_file(int $draftid): bool {
        global $USER;

        if (!$draftid) {
            return false;
        }
        $fs = get_file_storage();
        $files = $fs->get_area_files(\context_user::instance($USER->id)->id, 'user', 'draft', $draftid, 'id', false);
        foreach ($files as $file) {
            if (!$file->is_directory()) {
                return true;
            }
        }
        return false;
    }
}
