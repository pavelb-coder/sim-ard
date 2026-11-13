<?php
/**
 * Русские строки плагина RoboSim.
 *
 * @package    mod_robosim
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['robosim:addinstance'] = 'Добавлять элемент курса «Симулятор RoboSim»';
$string['robosim:view'] = 'Открывать симулятор';
$string['robosim:submit'] = 'Сдавать свою работу';
$string['robosim:grade'] = 'Оценивать сданные работы';
$string['robosim:viewreports'] = 'Смотреть отчёт по работам';

$string['pluginname'] = 'Симулятор RoboSim';
$string['modulename'] = 'Симулятор RoboSim';
$string['modulenameplural'] = 'Симуляторы RoboSim';
$string['pluginadministration'] = 'Настройки симулятора RoboSim';

$string['description'] = 'Описание';
$string['simulator'] = 'Симулятор и задание';
$string['preset'] = 'С чего начинает ученик';
$string['preset_help'] = 'Выберите готовый пример, учебное задание из набора или вставьте свой проект. Ученик откроет элемент курса с уже загруженной схемой и скетчем.';
$string['preset_examples'] = 'Готовые примеры';
$string['preset_tasks'] = 'Учебные задания (с автопроверкой)';
$string['preset_custom'] = 'Свой проект';
$string['preset_custom_desc'] = 'Вставить ссылку или загрузить файл';
$string['customproject'] = 'Ссылка на проект или JSON';
$string['customproject_help'] = 'Вставьте ссылку, которую даёт кнопка «Ссылка на схему» (часть после #p=), или целиком JSON из кнопки «Сохранить». Если загрузили файл, поле можно оставить пустым.';
$string['projectfile'] = 'Файл проекта';
$string['projectfile_help'] = 'Файл .json, сохранённый в симуляторе RoboSim. Используется только один файл, и он важнее вставленного текста.';
$string['prompt'] = 'Инструкция ученику';
$string['prompt_help'] = 'Показывается над симулятором. Можно писать обычным текстом или с форматированием.';

$string['gradesettings'] = 'Оценивание';
$string['autograde'] = 'Выставлять оценку сразу, когда автопроверка пройдена';
$string['autograde_help'] = 'Работает для элементов курса на основе учебного задания: когда все проверки пройдены, оценка сразу попадает в журнал. Если элемент курса собран из примера или своего проекта, за сдачу ставится полный результат.';
$string['maxattempts'] = 'Сколько попыток разрешено';
$string['maxattempts_help'] = 'Сколько раз ученик может сдать работу. 0 — без ограничений. Учитель сдаёт работу всегда.';

$string['startsfrom'] = 'Начало работы';
$string['task'] = 'Задание';
$string['attempts'] = 'Попытки';
$string['attempt'] = 'Попытка';
$string['bestresult'] = 'Лучший результат';
$string['maxgrade'] = 'Максимальная оценка';
$string['lastattempt'] = 'Последняя сдача';
$string['submitwork'] = 'Сдать работу';
$string['checkwork'] = 'Проверить без сдачи';
$string['openfullscreen'] = 'Открыть на весь экран';
$string['report'] = 'Сданные работы';
$string['howto'] = 'Внутри симулятора: клик по детали — она появится на схеме, тяните мышью чтобы двигать, клик по двум выводам — провод. Кнопка «Старт» запускает скетч. Если напряжение выше номинала, деталь сгорает — «Сброс» заменяет сгоревшие детали.';
$string['externalsimulator'] = 'Администратор направил этот элемент курса на внешнюю копию симулятора, поэтому сдача работы автоматически не собирается. Ученик работает и показывает результат на экране.';
$string['attemptsused'] = 'Попытки закончились. Попросите учителя добавить попытку.';
$string['nosubmissions'] = 'Пока никто не сдал работу.';

$string['source_example'] = 'пример «{$a}»';
$string['source_task'] = 'задание «{$a}»';
$string['source_file'] = 'файл {$a}';
$string['source_custom'] = 'проект учителя';
$string['source_submission'] = 'работа ученика';
$string['source_empty'] = 'пустая схема';

$string['viewingsubmission'] = 'Просмотр сданной работы.';
$string['viewingsubmissionfor'] = 'Ученик:';
$string['backtostudent'] = 'Вернуться к своему симулятору';
$string['passed'] = 'зачёт';
$string['failed'] = 'не пройдено';
$string['status'] = 'Состояние';
$string['grade'] = 'Оценка';
$string['actions'] = 'Действия';
$string['student'] = 'Ученик';
$string['savegrade'] = 'Сохранить';
$string['openwork'] = 'Открыть';
$string['downloadwork'] = 'Скачать';
$string['deleteattempt'] = 'Удалить';
$string['confirmdeleteattempt'] = 'Удалить эту работу?';
$string['gradesaved'] = 'Оценка сохранена';
$string['deletedattempt'] = 'Работа удалена';
$string['reportfor'] = 'Сданные работы: {$a}';
$string['backtoactivity'] = 'Назад к элементу курса';
$string['reset_attempts'] = 'Удалить все сданные работы RoboSim';

$string['defaultexample'] = 'Пример, который открывается по умолчанию';
$string['defaultexample_desc'] = 'Используется, когда учитель не менял начальное состояние.';
$string['allowexternal'] = 'Разрешить внешний адрес симулятора';
$string['allowexternal_desc'] = 'Позволяет грузить симулятор с другого сайта (например, с опубликованной страницы RoboSim) вместо копии внутри плагина.';
$string['simurl'] = 'Внешний адрес симулятора';
$string['simurl_desc'] = 'Полный адрес страницы симулятора, например https://example.org/sim-ard/ . Используется только при включённой настройке «Разрешить внешний адрес симулятора».';
$string['settingsheading'] = 'RoboSim';
$string['settingsheading_desc'] = 'Сам симулятор лежит внутри плагина, в каталоге mod/robosim/simulator. Интернет для работы не нужен.';
$string['aboutheading'] = 'Что внутри';
$string['aboutheading_desc'] = 'В плагине {$a} готовых примеров, 8 учебных заданий с автопроверкой, решатель цепей, компиляторы C++ и MicroPython и реалистичная отрисовка деталей. Полное описание — в README.md плагина.';

$string['error_badproject'] = 'Это не похоже на проект RoboSim: вставьте ссылку после #p= или JSON из кнопки «Сохранить».';
$string['error_toolong'] = 'Скетч слишком длинный (предел — 200 000 символов).';
$string['error_noproject'] = 'Выберите пример, задание, загрузите файл проекта или вставьте ссылку на проект.';

$string['event_submission_created'] = 'Работа в симуляторе RoboSim сдана';
$string['privacy:metadata:robosim_submissions'] = 'Сданные работы: схема, скетч и результат автопроверки.';
$string['privacy:metadata:robosim_submissions:userid'] = 'Ученик, сдавший работу.';
$string['privacy:metadata:robosim_submissions:attempt'] = 'Номер попытки.';
$string['privacy:metadata:robosim_submissions:schematic'] = 'Схема, собранная учеником (JSON).';
$string['privacy:metadata:robosim_submissions:code'] = 'Скетч, написанный учеником.';
$string['privacy:metadata:robosim_submissions:score'] = 'Результат автопроверки в процентах.';
$string['privacy:metadata:robosim_submissions:checks'] = 'Подробности автопроверки.';
$string['privacy:metadata:robosim_submissions:timecreated'] = 'Когда работа была сдана.';
$string['privacy:submissions'] = 'Сданные работы RoboSim';
