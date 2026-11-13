<?php
/**
 * English strings for the RoboSim activity module.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['robosim:addinstance'] = 'Add a new RoboSim simulator';
$string['robosim:view'] = 'View the simulator';
$string['robosim:submit'] = 'Submit own work';
$string['robosim:grade'] = 'Grade submitted work';
$string['robosim:viewreports'] = 'View submissions report';

$string['pluginname'] = 'RoboSim simulator';
$string['modulename'] = 'RoboSim simulator';
$string['modulenameplural'] = 'RoboSim simulators';
$string['pluginadministration'] = 'RoboSim administration';

$string['description'] = 'Description';
$string['simulator'] = 'Simulator and task';
$string['preset'] = 'Starting point';
$string['preset_help'] = 'Choose a ready example, a learning task from the built-in set, or paste your own project. The student opens the activity with this circuit and sketch already loaded.';
$string['preset_examples'] = 'Ready examples';
$string['preset_tasks'] = 'Learning tasks (auto-checked)';
$string['preset_custom'] = 'My own project';
$string['preset_custom_desc'] = 'Paste a project link or upload a file';
$string['customproject'] = 'Project link or JSON';
$string['customproject_help'] = 'Paste the link the simulator gives with the «Link to circuit» button (the part after #p=), or the whole JSON from the «Save» button. Leave empty if you upload a file.';
$string['projectfile'] = 'Project file';
$string['projectfile_help'] = 'A .json file saved from the RoboSim simulator. Only one file is used; it has priority over the pasted text.';
$string['prompt'] = 'Instructions for the student';
$string['prompt_help'] = 'Shown above the simulator. Plain text or formatted text — your choice.';

$string['gradesettings'] = 'Grading';
$string['autograde'] = 'Grade automatically when the task check passes';
$string['autograde_help'] = 'Works for activities built on a learning task: when all checks pass, the grade is put into the gradebook right away. If the activity starts from an example or your own project, submitting the work counts as the full result.';
$string['maxattempts'] = 'Attempts allowed';
$string['maxattempts_help'] = 'How many times a student may submit work. 0 means unlimited. Teachers can always submit.';

$string['startsfrom'] = 'Starts from';
$string['task'] = 'Task';
$string['attempts'] = 'Attempts';
$string['attempt'] = 'Attempt';
$string['bestresult'] = 'Best result';
$string['maxgrade'] = 'Max grade';
$string['lastattempt'] = 'Last submission';
$string['submitwork'] = 'Submit work';
$string['checkwork'] = 'Check without submitting';
$string['openfullscreen'] = 'Open full screen';
$string['report'] = 'Submissions';
$string['howto'] = 'Inside the simulator: click a component to add it, drag to move, click two pins to connect them with a wire. Press «Start» to run the sketch. A component burns out if the voltage exceeds its rating — «Reset» replaces burnt parts.';
$string['externalsimulator'] = 'The site administrator pointed this activity to an external copy of the simulator, so submissions are not collected automatically. The student works and shows the result on screen.';
$string['attemptsused'] = 'All attempts are used. Ask your teacher to allow more.';
$string['nosubmissions'] = 'Nobody has submitted work yet.';

$string['source_example'] = 'example «{$a}»';
$string['source_task'] = 'task «{$a}»';
$string['source_file'] = 'file {$a}';
$string['source_custom'] = 'teacher project';
$string['source_submission'] = 'student submission';
$string['source_empty'] = 'blank circuit';

$string['viewingsubmission'] = 'Viewing a submitted work.';
$string['viewingsubmissionfor'] = 'Student:';
$string['backtostudent'] = 'Back to my own simulator';
$string['status_loading'] = 'The simulator is loading…';
$string['status_ready'] = 'The simulator is ready. Build the circuit and press «Submit work».';
$string['status_notask'] = 'This activity has no task to check automatically: your teacher will review the work.';
$string['status_passed'] = 'Task passed';
$string['status_failed'] = 'Task not passed';
$string['status_sent'] = 'Work submitted';
$string['status_sentscore'] = 'Work submitted, result: ';
$string['status_sending'] = 'Sending…';
$string['status_error'] = 'Could not send the work: ';
$string['status_noframe'] = 'The simulator has not loaded yet — wait a couple of seconds.';
$string['status_offline'] = 'The simulator page is unavailable.';
$string['status_needrun'] = 'Press «Start» in the simulator first and let the circuit run for a couple of seconds: some checks look at the running circuit. Press the button again to submit anyway.';
$string['status_grade'] = 'grade: ';
$string['status_left'] = 'Attempts left: ';
$string['passed'] = 'passed';
$string['failed'] = 'not passed';
$string['status'] = 'Status';
$string['grade'] = 'Grade';
$string['actions'] = 'Actions';
$string['student'] = 'Student';
$string['savegrade'] = 'Save';
$string['openwork'] = 'Open';
$string['downloadwork'] = 'Download';
$string['deleteattempt'] = 'Delete';
$string['confirmdeleteattempt'] = 'Delete this submission?';
$string['gradesaved'] = 'Grade saved';
$string['deletedattempt'] = 'Submission deleted';
$string['reportfor'] = 'Submissions: {$a}';
$string['backtoactivity'] = 'Back to the activity';
$string['reset_attempts'] = 'Delete all RoboSim submissions';

$string['defaultexample'] = 'Example opened by default';
$string['defaultexample_desc'] = 'Used when a teacher leaves the starting point untouched.';
$string['allowexternal'] = 'Allow an external simulator URL';
$string['allowexternal_desc'] = 'Makes it possible to load the simulator from another site (for example the published RoboSim page) instead of the copy inside the plugin.';
$string['simurl'] = 'External simulator URL';
$string['simurl_desc'] = 'Full URL of the simulator page, for example https://example.org/sim-ard/ . Only used when «Allow an external simulator URL» is on.';
$string['settingsheading'] = 'RoboSim';
$string['settingsheading_desc'] = 'The simulator itself is shipped inside the plugin, in the folder mod/robosim/simulator. No internet access is required.';
$string['aboutheading'] = 'What is inside';
$string['aboutheading_desc'] = 'The plugin contains {$a} ready examples, 8 learning tasks with automatic checks, the circuit solver, the C++/MicroPython compilers and realistic component rendering. The full description is in README.md of the plugin.';

$string['error_badproject'] = 'This does not look like a RoboSim project: paste the link after #p= or the JSON from the «Save» button.';
$string['error_toolong'] = 'The sketch is too long (limit 200 000 characters).';
$string['error_noproject'] = 'Choose an example, a task, upload a project file or paste a project link.';

$string['event_submission_created'] = 'RoboSim work submitted';
$string['privacy:metadata:robosim_submissions'] = 'Submitted RoboSim works: circuit, sketch and check result.';
$string['privacy:metadata:robosim_submissions:userid'] = 'The student who submitted the work.';
$string['privacy:metadata:robosim_submissions:attempt'] = 'Attempt number.';
$string['privacy:metadata:robosim_submissions:schematic'] = 'The circuit assembled by the student (JSON).';
$string['privacy:metadata:robosim_submissions:code'] = 'The sketch written by the student.';
$string['privacy:metadata:robosim_submissions:score'] = 'Result of the automatic check, in percent.';
$string['privacy:metadata:robosim_submissions:checks'] = 'Details of the automatic check.';
$string['privacy:metadata:robosim_submissions:timecreated'] = 'When the work was submitted.';
$string['privacy:submissions'] = 'RoboSim submissions';
