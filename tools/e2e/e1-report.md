# Э1 — отчёт по ТЗ 4.2.1–4.2.14

Дата: 2026-10-29. Сервер: Windows 10, Chrome for Testing 156.0.8078.47, headless (новый), WebGL —
ANGLE Vulkan **SwiftShader** (программный рендер, без GPU), `--lang=en-US`, unpacked из корня зеркала.
Движок: @mlightcad/cad-simple-viewer 1.7.6 + libredwg-web 0.7.17 (vendored, `tools/vendor-build.js`).
Прогоны: batch1 `RUN … 2026-10-29T13:13:33` (`tools/e2e/e1/manifests/plan-e1.json`),
batch2 `RUN … 2026-10-29T14:07:52` (`manifests/plan-e1b.json`), `BATCH-END steps=5 failed=1`, `EXIT 0 chromes_left=12`
(упал только шаг инкогнито, см. 4.2.14). Артефакты (в git не идут):
`tools/e2e/out/pull-batch1/e1/`, `tools/e2e/out/pull-batch2/e1/`.

Все «прошло» ниже — по прогону на сервере после успешного `sync`, кроме строк с пометкой «здесь».
Времена — на SwiftShader без GPU; на обычном ноутбуке с GPU отрисовка быстрее, разбор файла — тот же.

## Сводная таблица

| № | Что проверяем | Критерий ТЗ | Как | Цифры | Итог | Если не прошло (ТЗ) |
|---|---|---|---|---|---|---|
| 4.2.1 | Отрисовка по версиям DWG | ≥20 DWG, ≥2 на версию AC1014–AC1032, ≥95 % поддерживаемых типов, SPLINE и HATCH на всех файлах, где есть, нет пустого экрана без карточки | сервер, open-corpus.js; эталон — подсчёт по типам dwgread (LibreDWG 0.14) + ezdxf/сырой DXF на 3 файлах | 26 DWG, 7 версий × 2–5 файлов; 25 из 25 настоящих файлов ≥95 % поддерживаемых; SPLINE нарисован в 14 из 14, HATCH в 16 из 16; 1 файл, записанный LibreDWG, — карточка (не пустой экран) | **прошло**; визуальный эталон из Autodesk Viewer не делался (нужен логин Autodesk) | стоп не нужен: SPLINE, HATCH и 2018 проходят |
| 4.2.2 | DXF ASCII и binary | ≥10 DXF, 95 % | сервер | 56 DXF (54 ASCII + 2 binary), открылись 56 из 56; ≥95 % поддерживаемых — 48 из 56 | **частично**: Leader.dxf (7 копий) 9 из 10, material.dxf 2 из 3, тип пропуска счётчик не различил | — |
| 4.2.3 | Счётчик «нарисовано из» | совпадает с ручным подсчётом на 3 файлах | здесь (ezdxf, dwgread, grep по DXF) против сервера | sample_AC1032: ezdxf 167, dwgread 163, вьюер 164; canteen: dwgread 25125, DXF 25125, вьюер 25125; export_sample: ezdxf 234, вьюер 234 | **прошло** (расхождение sample_AC1032 объяснено ниже) | — |
| 4.2.4 | Время и память | DXF 1 МБ ≤2 с, DWG 5 МБ ≤5 с, DWG 20 МБ ≤20 с; нехватка памяти → карточка 3 | сервер | настоящие DXF ~1 МБ: 0,9–1,9 с; синтетика DXF 1 МБ: 5,5 с; DXF 20 МБ: 25,7 с, 698 МБ; DXF 50 МБ: карточка 3 по таймауту 60 с, пик 1205 МБ, вкладка жива; DWG 2,5 МБ (canteen): 6,3 с | **не прошло / не проверено**: цели по DWG 5 и 20 МБ не измерены (нет настоящих DWG ≥5 МБ, синтетика LibreDWG не рисуется); то, что измерено, медленнее целей | ставим `OPEN_TIME_LIMIT_S` и `LINK_LIMIT_MB` по замерам |
| 4.2.5 | WASM под CSP MV3 | работает без `unsafe-eval` | сервер | csp-нарушений 0 на 26 DWG + 56 DXF + размерах; `new Function` в vendor 0 | **прошло** | — |
| 4.2.6 | Ноль сетевых запросов, шрифты | ни одного внешнего запроса | сервер, перехват запросов | `extRequests` 0 на всех открытиях с диска; по ссылке — только сам источник | **прошло**; шрифтов в пакете нет — текст без шрифта виден, но плашка пишет имена шрифтов как «объекты» (Э2) | — |
| 4.2.7 | Листы (Layout) | вкладки Model + листы работают | сервер, interactions.js | 3 вкладки, клик меняет лист и `aria-selected`, холст жив | **прошло**; имена вкладок — имена блоков `*Paper_Space0`, а не имена листов (Э2) | F-12 «только Model» — не нужно |
| 4.2.8 | Ссылки: cookies, редиректы, Content-Disposition, реальные сайты | файл приходит с куками сессии | сервер, cookies.js, свой HTTP-стенд + github | Lax/Strict/None/без атрибута и сторонняя `None` — все дошли; приватный файл 200 AC1032 1081979 байт, а не страница входа; редирект на CDN — куки CDN дошли; github → raw.githubusercontent 200 за 1316 мс; имя из Content-Disposition прочитано | **прошло на стенде**; реальные сайты за логином — не проверено: нужен логин | fallback: fetch из контент-скрипта, затем карточка 4 |
| 4.2.9 | Лимит файла по ссылке | число для `LINK_LIMIT_MB` | сервер, open-link.js (DNR) | DXF 20 МБ по ссылке: 144000 из 144000, 27,6 с, 713 МБ; DXF 50 МБ (46031 КБ) по ссылке: таймаут 61,1 с, 1287 МБ, карточка 3 | **прошло**: предлагаю `LINK_LIMIT_MB = 20` | заглушка 100 остаётся до замера |
| 4.2.10 | Перехват ссылки: DNR, web_accessible_resources, «Download instead» | клик по ссылке открывает вьюер | сервер, open-link.js | редирект main_frame на `viewer.html#raw=…` сработал без `web_accessible_resources`; 20 МБ по ссылке открылся | **прошло** DNR; «Download instead» — не проверено в браузере (код есть, прогона нет) | F-25 в 5.5 — не нужно |
| 4.2.11 | Ctrl+O | открывает выбор файла | сервер | `waitForFileChooser` поймал диалог | **прошло** (через API, настоящий ввод — у product-reviewer) | — |
| 4.2.12 | Alt+Shift+D | нет конфликтов | сервер, `chrome.commands.getAll` | `[{"name":"_execute_action","shortcut":"Alt+Shift+D"}]` — Chrome назначил клавишу в чистом профиле | **прошло через API**; конфликты на уровне ОС и настоящий ввод — у product-reviewer | без suggested_key |
| 4.2.13 | Печать | имя PDF «{file} · {layout}», без колонтитулов, MAX_RENDERBUFFER_SIZE | сервер, print.js | title `sample_AC1032.dwg · Model`; MAX_RENDERBUFFER_SIZE 8192; PDF A4, 1 стр.; холст в PDF: 0,03 % тёмных пикселей в центре, с `preserveDrawingBuffer` — 100 % | **не прошло**: чертёж на печати пустой (WebGL без preserveDrawingBuffer), на лист попадают «Type command» и тулбар движка | пометка в 4.3 и README |
| 4.2.14 | Инкогнито | вьюер в том же инкогнито-окне | сервер, cookies.js --incognito | доступ выдан (`isActive:true`), дальше зависание, SIGTERM через 1800 с, 2 прогона из 2 | **не проверено**: харнесс теряет расширение после выдачи доступа | запасной путь: без перехвата в инкогнито; настоящий ввод — у product-reviewer |

## Предлагаемые значения

- `{oldest}` = **AC1014** (R14), `{newest}` = **AC1032** (2018). Все 7 версий прошли критерий 4.2.1
  на настоящих файлах из AutoCAD; старше R14 в корпусе нет ни одного DWG — их не ставим в диапазон.
- `OPEN_TIME_LIMIT_S` = **60** (оставить). Самое долгое удачное открытие — DXF 20 МБ за 25,7 с
  (по ссылке 27,6 с), запас ×2,2 на медленном сервере; DXF 50 МБ за 60 с не успевает и честно даёт карточку 3.
- `LINK_LIMIT_MB` = **20**. 20 МБ по ссылке открывается за 27,6 с при пике 713 МБ; 50 МБ — нет.
  Для DWG запас меньше: canteen 2,5 МБ = 6,3 с и 128 МБ, при линейном росте DWG ~24 МБ упрётся
  в 60 с. Интервал честный: граница где-то между 20 и 50 МБ DXF, точнее без настоящих больших DWG не сказать.
- **F-12** (вкладки листов) — оставить; в Э2 подписывать вкладки именами листов, а не блоков.
- **F-25** (перехват ссылок) — оставить в MVP: DNR-редирект работает, куки доходят.
- **Хоткей** — оставить `suggested_key` Alt+Shift+D.

## 4.2.1 — корпус DWG по файлам

Эталон — dwgread (LibreDWG 0.14, сущности без BLOCK/ENDBLK/VIEWPORT; LibreDWG считает по-своему,
например не учитывает объекты листов, поэтому для export_sample 70 против 234 у ezdxf и вьюера).
«% подд.» — нарисовано / (всего − 3DSOLID/REGION/BODY/SURFACE/MESH и PROXY), раздел 3.2 ТЗ:
твёрдые тела не рисуем. Скриншот каждого: `tools/e2e/out/pull-batch1/e1/screens/<dir>_<file>_real.png`.

| Файл | Версия | Программа | dwgread | вьюер всего / нарисовано | % подд. | Не нарисовано | SPLINE / HATCH | мс | пик МБ |
|---|---|---|---|---|---|---|---|---|---|
| acadsharp/sample_AC1014.dwg | AC1014 | AutoCAD 2025 (сохранено в R14) | 163 | 164 / 162 | 100 % | 3DSOLID×2 | SPLINE да; HATCH да | 1885 | 40 |
| libredwg-testdata/example_r14.dwg | AC1014 | AutoCAD | 68 | 65 / 64 | 100 % | 3DSOLID×1 | SPLINE да; HATCH да | 1821 | 37 |
| acadsharp/sample_AC1015.dwg | AC1015 | AutoCAD 2025 | 163 | 164 / 162 | 100 % | 3DSOLID×2 | SPLINE да; HATCH да | 1603 | 41 |
| libredwg-testdata/example_2000.dwg | AC1015 | AutoCAD | 68 | 65 / 64 | 100 % | 3DSOLID×1 | SPLINE да; HATCH да | 1250 | 43 |
| gdal/text_mtext_attdef_r2000.dwg | AC1015 | не указана | 3 | 3 / 3 | 100 % | — | — | 622 | 30 |
| libredwg-written/example_2000_by_libredwg.dwg | AC1015 | LibreDWG (запись) | 68 | — | — | карточка «This drawing is too large to open here» (на деле TypeError разбора — должна быть карточка 2) | — | — | 21 |
| acadsharp/sample_AC1018.dwg | AC1018 | AutoCAD 2025 | 141 | 145 / 143 | 100 % | 3DSOLID×2 | SPLINE да; HATCH да | 1507 | 37 |
| libredwg-testdata/example_2004.dwg | AC1018 | AutoCAD 2018 | 68 | 65 / 64 | 100 % | 3DSOLID×1 | SPLINE да; HATCH да | 1096 | 39 |
| acadsharp/sample_AC1021.dwg | AC1021 | AutoCAD 2025 | 161 | 164 / 162 | 100 % | 3DSOLID×2 | SPLINE да; HATCH да | 1485 | 60 |
| mlightcad/canteen.dwg | AC1021 | AutoCAD 2022 | 25123 | 25125 / 25124 | 100 % | 3DSOLID×1 | SPLINE да; HATCH да | 5796 | 133 |
| mlightcad/map-of-uae.dwg | AC1021 | AutoCAD 2022 | 129 | 131 / 131 | 100 % | — | HATCH да | 995 | 147 |
| autodesk/architectural_-_annotation_scaling_and_multileaders.dwg | AC1021 | AutoCAD 2008 | 1375 | 1380 / 1379 | 99,9 % | OTHER×1 | HATCH да | 4197 | 228 |
| autodesk/blocks_and_tables_-_metric.dwg | AC1021 | AutoCAD 2007 | 504 | 507 / 506 | 99,8 % | OTHER×1 | — | 2192 | 116 |
| acadsharp/sample_AC1024.dwg | AC1024 | AutoCAD 2025 | 161 | 164 / 162 | 100 % | 3DSOLID×2 | SPLINE да; HATCH да | 1611 | 128 |
| autodesk/civil_example-imperial.dwg | AC1024 | AutoCAD 2010 | 39 | 41 / 41 | 100 % | — | — | 1014 | 143 |
| autodesk/mechanical_example-imperial.dwg | AC1024 | AutoCAD 2010 | 88 | 90 / 90 | 100 % | — | — | 939 | 162 |
| autodesk/visualization_-_condominium_with_skylight.dwg | AC1024 | AutoCAD 2011 | 73 | 69 / 17 | 100 % | 3DSOLID×52 | SPLINE да | 1245 | 163 |
| acadsharp/sample_AC1027.dwg | AC1027 | AutoCAD 2025 | 161 | 164 / 162 | 100 % | 3DSOLID×2 | SPLINE да; HATCH да | 2041 | 94 |
| gdal/Building_A_Floor_0_Mapwize.dwg | AC1027 | AutoCAD 2017 | 275 | 248 / 248 | 100 % | — | — | 2062 | 122 |
| gdal/attribs.dwg | AC1027 | ODA SDK (Teigha 22.6) | 59 | 60 / 53 | 100 % (88 % от всех) | OTHER×7 = PROXY_ENTITY×7 по dwgread | — | 1845 | 115 |
| acadsharp/sample_AC1032.dwg | AC1032 | AutoCAD 2025 | 161 | 164 / 162 | 100 % | 3DSOLID×2 | SPLINE да; HATCH да | 2276 | 74 |
| acadsharp/export_sample.dwg | AC1032 | AutoCAD 2025 | 70 | 234 / 233 | 99,6 % | OTHER×1 | HATCH да | 1250 | 95 |
| mlightcad/baseline-sample.dwg | AC1032 | AutoCAD 2025 (zh-CN) | 169 | 170 / 170 | 100 % | — | SPLINE да; HATCH да | 2784 | 80 |
| owerko/hatches.dwg | AC1032 | AutoCAD 2023 | 16 | 16 / 16 | 100 % | — | HATCH да | 1856 | 54 |
| owerko/spline.dwg | AC1032 | AutoCAD 2023 | 11 | 11 / 11 | 100 % | — | SPLINE да | 1754 | 62 |
| owerko/dimensions.dwg | AC1032 | AutoCAD 2023 | 43 | 39 / 39 | 100 % | — | — | 1950 | 69 |

Глазами (скриншоты): hatches.dwg — сплошная, узорная и градиентная штриховки на месте;
spline.dwg — кривые нарисованы, но есть длинные жёлтые прямые, которых, вероятно, в файле нет
(лишние сегменты SPLINE, разобрать в Э2 рядом с эталоном). Во всех скриншотах поверх холста видны
строка «Type command» и тулбар undo/redo/delete движка — в Э2 скрыть.

Пробел корпуса: нет DWG из BricsCAD, DraftSight, ZWCAD (найденные публичные файлы — только AutoCAD,
ODA SDK и LibreDWG). Файл, записанный LibreDWG, не открывается — это та же беда, что у синтетики (4.2.4).

## 4.2.2 — DXF

56 файлов LibreDWG test-data (r12–2018, 2 binary: example_2000.dxfb 65 из 69, example_2018.dxfb 39 из 40),
открылись 56 из 56, csp 0, внешних запросов 0, время 206–1608 мс, пик до 97 МБ.
Ниже 95 % от всех: example_* (UNKNOWN×4 — 3D/proxy), Surface.dxf 11 из 18, Underlay.dxf 0 из 3
(подложки PDF/DWF — не поддерживаем), LiveSection1, entities — UNKNOWN; по поддерживаемым типам
это 100 %. Не объяснено: **Leader.dxf** (7 копий, 9 из 10) и **material.dxf** (2 из 3) — один объект
«OTHER», счётчик не назвал тип. Задача Э2: называть тип в Details и проверить LEADER.

## 4.2.3 — счётчик против ручного подсчёта

| Файл | Независимо | Вьюер (всего) |
|---|---|---|
| acadsharp/sample_AC1032.dwg | ezdxf 167 (из DXF-экспорта того же примера), dwgread 163 | 164 |
| mlightcad/canteen.dwg | dwgread 25125 (с объектами блоков), сырой DXF 25125 | 25125 |
| acadsharp/export_sample.dwg | ezdxf 234 | 234 |

sample_AC1032: разбор libredwg-web теряет MESH×2, REGION и PDFUNDERLAY — это 3D и подложка,
которые мы и так не рисуем; счётчик показывает то, что пришло из разбора.

## 4.2.4 — время и память

| Файл | Размер | Объектов | Время до отрисовки | Пик памяти вкладки | Цель 6.2 |
|---|---|---|---|---|---|
| libredwg/example_r13.dxf | 1178 КБ | — | 1109 мс | — | ≤2 с — да |
| TS1_2000.dxf | 1033 КБ | — | 1920 мс | — | ≤2 с — да |
| example_2000.dxf | 1355 КБ | — | 908 мс | — | ≤2 с — да |
| синтетика size_1mb.dxf | 896 КБ | 7200 (1800 TEXT) | 5532 мс | 60 МБ | ≤2 с — **нет** |
| Dynblocks.dwg | 2,1 МБ | — | 3479 мс | 86 МБ | — |
| canteen.dwg | 2,5 МБ | 25125 | 6332 мс | 128 МБ | (5 МБ ≤5 с — уже 2,5 МБ дольше) |
| Dynblocks.dxf | 10 МБ | — | 1668 мс | 97 МБ | — |
| синтетика size_20mb.dxf | 18,2 МБ | 144000 | 25674 мс | 698 МБ | — |
| синтетика size_50mb.dxf | 46 МБ | 360000 | карточка 3 по таймауту 60 с | 1205 МБ | вкладка не упала — да |

DWG 5 и 20 МБ — **не проверено**: настоящих публичных DWG ≥5 МБ не нашлось, а синтетика через
LibreDWG dxf2dwg непригодна (из R2000 пишет два `*Model_Space`, из R12 — блоки без имён; вьюер
рисует пустой экран; 5 МБ конвертируется ~7 мин). Синтетика DXF плотная: в каждом квадрате текст,
а текст — самое дорогое в движке; поэтому 1 МБ синтетики в 3–5 раз дольше настоящего 1 МБ.
Нехватку памяти (RangeError / OOM из wasm) вызвать не удалось: 50 МБ упираются в таймаут раньше памяти.

Найденная ошибка: на файле, записанном LibreDWG, и на 50 МБ ошибка разбора
`TypeError: Cannot read properties of null (reading 'curDocument')` показывается как карточка 3;
для 50 МБ это верно (таймаут), для LibreDWG-файла по ТЗ F-6 должна быть карточка 2. Э2.

## 4.2.5 — WASM под CSP

`content_security_policy.extension_pages = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`.
Два `new Function` в vendor заменены патчем `tools/vendor-patch-csp.js` при сборке; CSP-нарушений 0
на всех прогонах batch1/batch2.

## 4.2.6 — ноль сетевых запросов, шрифты

На всех открытиях с диска `extRequests` 0, `failedReq` пусто; каталог шрифтов движка перенаправлен
на `fonts/` в пакете (`fonts.json = []`, шрифтов нет). Текст без шрифта рисуется запасным, но плашка
предупреждения пишет «Some objects were not drawn: 9 simplex, 9 ltypeshp, 9 simsun» — это шрифты,
а не объекты, и спорит со счётчиком «11 of 11 objects drawn» (скриншот owerko_spline.dwg_real.png). Э2.

## 4.2.7 — листы

interactions.js на sample_2018.dwg: 3 вкладки (Model, *Paper_Space, *Paper_Space0), клик переключает
активный блок (`btrSwitch:true`), `aria-selected` и холст жив (`canvasStill:true`). Имена вкладок —
имена блоков, в print.js заголовок листа `sample_AC1032.dwg · *Paper_Space0`, а нужен «Layout1». Э2.

## 4.2.8 — ссылки и куки

cookies.js поднимает два хоста (`a.test`, `cdn.test` через `--host-resolver-rules`), ставит куки
Lax/Strict/None/без атрибута и стороннюю `tp_none`, и качает файл из воркера `fetch(…, {credentials:'include'})`:

- publicA 200 за 12 мс; privateA 200 за 8 мс — пришёл файл (AC1032, 1081979 байт), не страница входа;
- redirectToCdn — редирект на cdn.test, куки cdn.test дошли; cdnDirect 200 за 8 мс;
- realPublicRedirect — github.com → raw.githubusercontent.com, 200 за 1316 мс;
- `Content-Disposition: attachment; filename="Real Name (rev 2).dwg"` прочитан;
- viewerFlow: открытие через `#src=` дало заголовок `plan.dwg · Model`; `sec-fetch-site: none`.

Реальные сайты за логином (Google Drive, Dropbox, SharePoint, Autodesk Docs) — **не проверено: нужен логин**,
это product-reviewer на втором Маке.

## 4.2.9 — лимит по ссылке

Прошлый провал «20 МБ по ссылке — таймаут 2 из 2» был не лимитом размера, а остановкой
`requestAnimationFrame` во фоновой вкладке; исправлено патчем patchYield (уступка через MessageChannel),
red/green проверено в прошлом запуске. Сейчас:

| Файл | Путь | Результат | Время | Память |
|---|---|---|---|---|
| size_20mb.dxf (18243 КБ, 144000 сущностей) | ссылка, DNR → `viewer.html#raw` | 144000 из 144000 | открытие 27 599 мс | 713 МБ |
| size_50mb.dxf (46031 КБ, 360000 сущностей) | ссылка, DNR → `viewer.html#raw` | **нет**: карточка 3 по таймауту 60 с | 61 094 мс | 1287 МБ |
| size_20mb.dxf | выбор файла | 144000 из 144000 | 25 674 мс | 698 МБ |
| size_50mb.dxf | выбор файла | **нет**: карточка 3 по таймауту 60 с | — | 1205 МБ |

Строки из лога batch2: `STEP-END rc=0 s=34 :: tools/e2e/e1/open-link.js` (20 МБ),
`STEP-END rc=0 s=88 :: tools/e2e/e1/open-link.js` (50 МБ). На 50 МБ после таймаута в консоли
`TypeError: … curDocument` — это следствие прерванного открытия, а не причина.

Вывод: по ссылке 20 МБ проходит с запасом по времени (27,6 из 60 с) и по памяти; 50 МБ на сервере без GPU
не укладывается в OPEN_TIME_LIMIT_S. Предлагаю `LINK_LIMIT_MB = 20`: файл больше не открывается из ссылки, карточка 4 с размером
(ТЗ раздел 4.3, F-21). Промежуточные 30–40 МБ не мерили.

## 4.2.10 — перехват ссылки

DNR-правило редиректит main_frame `*.dwg/*.dxf` на `chrome-extension://…/src/viewer/viewer.html#raw=<url>`;
`web_accessible_resources` для этого не понадобился (`urlIsExtension:true`). Маленький файл 6 из 6 за 1024 мс,
20 МБ DXF 144000 из 144000 за 27,6 с. «Download instead» (одноразовый пропуск правила `allowDownloadOnce`
в service worker) — **не проверено в браузере**: код есть, сценарий в харнесс не вошёл.

## 4.2.11 — Ctrl+O

Ctrl+O на странице вьюера — `page.waitForFileChooser` поймал диалог выбора файла.
Через API, настоящий ввод — у product-reviewer.

## 4.2.12 — Alt+Shift+D

`chrome.commands.getAll()` на сервере: `[{"name":"_execute_action","shortcut":"Alt+Shift+D"}]` — Chrome
назначил клавишу в чистом профиле, конфликта с клавишами Chrome нет. Нажатие на уровне ОС из headless
не эмулируется: через API, настоящий ввод — у product-reviewer (Mac и Windows).

## 4.2.13 — печать

- Заголовок вкладки `sample_AC1032.dwg · Model` — Chrome подставляет его как имя PDF.
- GL: ANGLE (Vulkan SwiftShader), MAX_RENDERBUFFER_SIZE 8192, MAX_TEXTURE_SIZE 8192; буфер 8192 выделяется,
  16384 — нет контекста; холст 1280×782.
- PDF A4 альбомный, 1 страница. **Чертёж на листе пустой**: движок создаёт WebGLRenderer без
  `preserveDrawingBuffer`, к моменту печати буфер очищен. Поверх — строка «Type command» и тулбар движка
  (их `@media print` не прячет).

Проверка исправления без правки продукта (print.js, вторая страница с принудительным
`preserveDrawingBuffer: true`). PDF отрисованы `pdftoppm -r 50 -gray`, считаны тёмные пиксели (< 200)
в центральной области листа:

| PDF | Размер | Тёмные пиксели, весь лист | В центре листа |
|---|---|---|---|
| print-zero (как есть, колонтитулы-шаблоны) | 69 128 байт | 2,33 % | 0,00 % |
| print-margin (поля 1 см) | 69 207 байт | 1,17 % | 0,03 % |
| print-plain (как есть, без шаблонов) | 45 286 байт | 0,94 % | 0,03 % |
| print-pdb (`preserveDrawingBuffer: true`) | 49 974 байт | 97,18 % | 100,00 % |

Итог: с `preserveDrawingBuffer` холст на печать попадает (`render-pdb.png`), без него лист пустой
(`render-plain.png`). Но попадает он с тёмным фоном вьюера — лист почти целиком чёрный. На Э2 нужен
снимок холста для печати на белом фоне (тёмные линии), а не просто флаг. Картинки:
`tools/e2e/out/pull-batch2/e1/print/render-plain.png`, `render-pdb.png`.

- Колонтитулы: `@page { margin: 0 }` в `viewer.css` есть, но puppeteer с `displayHeaderFooter` рисует их
  при любых полях, поэтому то, что убирает их настоящий диалог печати, — **через API не доказуемо**,
  настоящий ввод — у product-reviewer.

## 4.2.14 — инкогнито

**Не проверено: зависание после выдачи доступа в инкогнито.** Два прогона (batch1 и batch2) дали одно и то же:
`chrome.developerPrivate.updateExtensionConfiguration({incognitoAccess:true})` срабатывает
(`INCOG incognitoGrant {"ok":true,"incognitoAccess":{"isActive":true,"isEnabled":true}}`), после этого
Chrome перезапускает расширение, и харнесс больше не находит service worker; шаг снят по таймауту 30 мин:
`STEP-END rc=signal SIGTERM s=1800 :: tools/e2e/e1/cookies.js`. До окна инкогнито дело не дошло.
Это ограничение харнесса (headless + перезапуск расширения), а не продукта, но доказательства нет.

Что делать по ТЗ (столбец «если не прошло»): **запасной путь — в инкогнито не перехватывать**.
Манифест сейчас без ключа `incognito` (по умолчанию `spanning`), DNR-правило в инкогнито действует, только
если пользователь сам разрешил расширению инкогнито. Предлагаю на Э2 оставить так и проверить настоящим
вводом у product-reviewer (включить «Allow in Incognito», открыть ссылку на .dwg в окне инкогнито).

## Известные проблемы на Э2

1. Печать: пустой WebGL-холст. `preserveDrawingBuffer: true` доказанно выводит холст на лист, но с тёмным
   фоном — нужен снимок в `<img>` на белом фоне перед печатью; скрыть UI движка в `@media print`.
2. Поверх холста — «Type command» и тулбар движка.
3. Вкладки и заголовок листа — имена блоков `*Paper_Space0` вместо имён листов.
4. Ошибка разбора на файле от LibreDWG показывается карточкой 3 вместо карточки 2.
5. Плашка называет отсутствующие шрифты «объектами».
6. Счётчик пишет «OTHER» без типа (PROXY_ENTITY, вероятно LEADER) — Details должны назвать тип.
7. spline.dwg: лишние прямые рядом со сплайнами — сверить с эталоном.
8. Движок пропускает сущности на слое, которого нет в таблице LAYER (AutoCAD такие файлы открывает) —
   нашлось на первой версии синтетики.
9. Время: на сервере без GPU плотные файлы медленнее целей 6.2; на машине с GPU не мерили.
10. Инкогнито: проверка не доведена (4.2.14), харнесс теряет service worker после выдачи доступа.
11. На сервере после прогонов осталось `chromes_left=12` процессов Chrome — от двух снятых по таймауту шагов
    инкогнито (Chrome запускался этим харнессом); перед следующим прогоном их стоит снять.
