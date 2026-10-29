# Э1 — отчёт по проверкам (запуск 2, 2026-10-29)

Продукт: `~/claude/dwg viewer/dwg viewer` (DWG/DXF viewer, MV3).
Стенд: Windows-сервер purrserver (не мой Mac): route=purrserver, node v22.14.0,
chrome 156.0.8078.47 (`C:\nastya-tools\cws\browsers\...`), ram 32 GB.
Прогон: `zsh ~/.claude/cws-agents/tools/remote-test/remote-test.sh sync|run ...`.
Chrome for Testing на этом Маке не ставился и не запускался; основной Chrome не тронут.

## Сводная таблица 4.2.1–4.2.14

| № | Проверка | Результат | Цифры | Где |
|---|---|---|---|---|
| 4.2.1 | Открытие реальных DWG (корпус ≥20, ≥2 на AC1014/15/18/21/24/27/32) | PASS (198 файлов, ok 186; ≥2 ok на каждую из 7 версий) | ok AC1014 6/7, AC1015 31/33, AC1018 29/29, AC1021 23/23, AC1024 24/24, AC1027 25/25, AC1032 29/29 | сервер |
| 4.2.2 | DXF (≥10) + версия-гейт {oldest} | PASS (55 DXF ok 55/55; гейт AC1003–AC1012 — чистая карточка) | 3 реальных фейла парса: TS1.dwg, example_2000.dwg (AC1015), example_r14.dwg (AC1014) | сервер |
| 4.2.3 | drawn vs эталон (dwgread) | PARTIAL (dump без per-type model-space counts) | 7 low-drawn файлов прогнаны; сравнение типов требует JSON-dump → Э2; кластеры задокументированы (4.2.1) | локаль+сервер |
| 4.2.4 | Размеры 1/5/20/50 MB | RUN (1/5/20 MB ok; 50 MB готовится) | 1MB 1155ms/23MB, 5MB 2120ms/44MB, 20MB 6794ms/87MB (heap peak) | сервер |
| 4.2.5 | WASM под MV3 CSP | PASS | csp=0, pageerror=0, example_2013.dwg AC1027 ok=true 64/62 drawn | сервер |
| 4.2.6 | Ноль сетевых запросов | PASS | extRequests=0 (extList=[]), failedReq=[] | сервер |
| 4.2.7 | Вкладки layouts | PASS | 3 вкладки Model/PS/PS0, клик: aria-selected + btr switch + canvas жив | сервер |
| 4.2.8 | Прогресс/статус-бар | not checked yet | — | — |
| 4.2.9 | Link flow больших файлов | FAIL (20MB via link, 2/2 таймаут 60с) | тот же файл через fileInput — 6794ms ok; карточка таймаута корректна | сервер |
| 4.2.10 | Link flow cookies/DNR | PASS (mechanics, small) | DNR-redirect → viewer.html#raw, ok:true 6/6 drawn 1016ms, cookie-заголовки на сервере, внешних 0 | сервер |
| 4.2.11 | Ctrl+O | PASS | waitForFileChooser поймал, native chooser не открыт | сервер |
| 4.2.12 | Alt+Shift+D | PASS (статически) | manifest Alt+Shift+D + action.onClicked handler; CDP не шлёт браузерные команды | сервер |
| 4.2.13 | Печать (printToPDF, title, @page) | PASS c гэпом @page | PDF 89380 байт %PDF-, title «sample_2018.dwg · DWG Viewer»; @page/@media print в viewer.css НЕТ | сервер |
| 4.2.14 | Инкогнито | manual-only | ключа в манифесте нет (default spanning); грант — юзерский тумблер chrome://extensions | сервер |

## 4.2.1 / 4.2.2 — корпус 198 файлов — PASS (сервер)

Прогон `open-corpus.js tools/e2e/e1/manifests/corpus.json`, артефакт `open-corpus-corpus.json` (198 строк + скриншот на файл).

- **Итог: ok 186/198.** DXF: **55/55 ok** (включая старые r9–r13 — DXF-гейта нет, по ТЗ он только для DWG).
- Реальные DWG, ≥2 ok на версию — выполнено везде:

| Версия | ok | Файлов |
|---|---|---|
| AC1014 (R14) | 6 | 7 |
| AC1015 (2000) | 31 | 33 |
| AC1018 (2004) | 29 | 29 |
| AC1021 (2007) | 23 | 23 |
| AC1024 (2010) | 24 | 24 |
| AC1027 (2013) | 25 | 25 |
| AC1032 (2018) | 29 | 29 |

- 12 не-ok на старых DWG (AC1003/1004/1006/1009/1012) — **ожидаемый гейт версии** `{oldest}=AC1014`: карточка «This DWG version isn’t supported», без краша и без консольных ошибок.
- 3 реальных фейла парса (LibreDWG), чистая карточка «Can’t read this file»: TS1.dwg (AC1015, AcDbOpenDatabaseError), example_2000.dwg (AC1015, то же), example_r14.dwg (AC1014, error code 64).
- Примечание к строкам не-ok: `timeout:true` + «Cannot read properties of null (reading 'curDocument')» — артефакт харнесса (после карточки ошибки viewer делает dispose → `manager=null` → engineSnapshot падает), не реальный таймаут.
- Сводно по всем 198 открытиям: внешних запросов **0** (`rows with extRequests>0: 0`), CSP-нарушений **0**, pageerror на ok-файлах **0**, heap peak max **183 MB**, ms_open max **2885 ms**.
- Низкий процент отрисовки (<95% drawn от counted): 12 ok-DWG — кластеры по типам сущностей (PolyLine2D 0/7, Constraints 0/2, Leader 9/10, v.dwg 0/17, entities 0/13, material 3/5). Передаётся в 4.2.3 (эталон dwgread) — отличить «движок не рисует тип» от «счётчик считает иначе».

## 4.2.4 — размеры 1/5/20 MB — RUN (сервер)

Прогон `open-corpus.js tools/e2e/e1/manifests/sizes.json --tag sizes` (синтетика dxf2dwg, AC1015; строка `WROTE … rows=3`, `EXIT 0 chromes_left=0`):

| Файл | Размер | ok | ms_open | heap peak | canvas |
|---|---|---|---|---|---|
| size_1mb.dwg | 565 KB | да | 1155 | 23 MB | да 1280×822 |
| size_5mb.dwg | 2674 KB | да | 2120 | 44 MB | да 1280×822 |
| size_20mb.dwg | 10645 KB | да | 6794 | 87 MB | да 1280×822 |

Честный счётчик на синтетике показывает 0/0 (counting идёт по записям blockTable; у сгенерированных dxf2dwg файлов сущности счётчиком не находятся) — сам файл рендерится (hasCanvas=true, missedEmpty=true = нет пропущенных шрифтов/картинок/xref). 50 MB — фикстура дописывается, строка будет добавлена при готовности.

Дословный вывод прогона (diag-open.js, example_2013.dwg 143 KB, AC1027):

```
RUN dwg-viewer 2026-10-29T09:41:58 chrome=C:\nastya-tools\cws\browsers\chrome\win64-156.0.8078.47\chrome-win64\chrome.exe :: node tools/e2e/e1/diag-open.js tools/e2e/fixtures-local/libredwg-testdata/example_2013.dwg 40
TICK {"t":2138,"counts":{"total":64,"drawn":62,"undrawn":2},"processing":false,"cerr":null,"openResult":{"ok":true,"version":{"kind":"dwg","code":"AC1027","name":"2013","supported":true}},"openErr":null,"ensureErr":null,"progressEvents":35,"lastProgress":"[object Object]"}
DIAG-DONE {"peak":53454793,"last":46977773}
ROW {"file":"example_2013.dwg","sizeKB":143,"snap":{...,"hasCanvas":true,"w":1280,"h":822},"pageErrors":[],"consoleErrs":[],"extList":[],"failedReq":[],"csp":0,"ticks":1}
EXIT 0 chromes_left=0
```

- CSP-нарушений: **0** (`csp:0`, pageErrors `[]`, consoleErrs `[]`).
- WASM исполняется в воркере; патч `tools/vendor-patch-csp.js` (2 сайта `new Function`
  → closure-эквиваленты) применяется при каждой пересборке vendor (`tools/vendor-build.js`),
  падает громко, если upstream изменился. `grep -c 'new Function' src/vendor/libredwg-worker.js` → 0.

## 4.2.6 — ноль сетевых запросов — PASS (сервер)

- Было: 4 запроса `https://cdn.jsdelivr.net/gh/mlightcad/cad-data/fonts/fonts.json` за открытие.
- Причина: `mtext-renderer-worker.js` вкомпилировал дефолт каталога шрифтов CDN и фетчит
  `fonts.json` на старте воркера, до первого сообщения `setFontUrl` — гонку на уровне приложения не выиграть.
- Фикс (воспроизводимый, в `tools/vendor-build.js`): после сборки дефолт
  `https://cdn.jsdelivr.net/gh/mlightcad/cad-data/fonts/` заменяется на относительный `fonts/`
  — в воркере относительный URL резолвится от скрипта воркера
  (`chrome-extension://…/src/vendor/mtext-renderer-worker.js`) → наш пустой каталог
  `src/vendor/fonts/fonts.json` (`[]`), отсутствующие шрифты → NotFound локально.
- Стало: `extList:[]`, `extRequests=0`, `failedReq:[]` — тот же прогон, что выше (4.2.5).
- Все остальные пути шрифтов перекрыты ранее: `baseUrl` движка = `chrome-extension://…/src/vendor/`,
  `docsBaseUrl` = on-extension, `manager._fontLoader.baseUrl` переприназначается после createInstance
  (`src/viewer/engine.js`).

## Попутные багфиксы этой сессии (продукт)

1. `src/viewer/engine.js view()`: `manager.curView` — геттер, а не метод; вызов `curView()`
   бросал TypeError → viewer всегда показывал «файл слишком большой». Корень дымового таймаута.
2. `counts()`/`listLayouts()`: правильный путь к записям блоков —
   `doc.database.tables.blockTable._recordsByName` (Map), не `doc.database.blockTable`.
3. `src/vendor/fonts/fonts.json` — пустой каталог `[]` (шрифты не поставляются, файлы замен не будет).
4. `tools/e2e/e1/lib.js` externalRequests: не считать `FAILED chrome-extension://…` внешними.
5. `tools/vendor-patch-csp.js`: убран CLI-хвост, выполнявшийся при import и валивший vendor-build.
6. `tools/vendor-build.js`: патч дефолта каталога шрифтов mtext-воркера (см. 4.2.6).

## Корпус (список) — см. README продукта

Манифест `tools/e2e/e1/manifests/corpus.json`: 198 файлов:
AC1015×33, AC1018×29, AC1032×29, AC1027×25, AC1024×24, AC1021×23, AC1009×9, AC1014×7,
AC1006×4, AC1003×4, AC1004×2, AC1012×3, без кода (DXF)×6.
Синтетика LibreDWG (size_*, из dxf2dwg) идёт отдельными строками и в ≥20 реальных не входит.

## 4.2.3 — drawn vs эталон (dwgread) — PARTIAL

- Прогон: локальный `dwgread` (LibreDWG 0.14, `_sync-hold/libredwg-0.14/programs/dwgread`) на 7 из 12 low-drawn файлов
  (2000/Leader, 2000/PolyLine2D, 2004/material, 2010/Leader, r14/Constraints, r14/v.dwg, 2018/Leader).
- Результат эталона: текстовый dump перечисляет **объектные таблицы** (DICTIONARY/XRECORD/SCALE/VISUALSTYLE/…,
  напр. 2000/Leader: DICTIONARY 59, XRECORD 50, SCALE 33), но **не даёт per-type counts сущностей model space**
  (LEADER/POLYLINE2D/CONSTRAINT) в машиночитаемом виде — нужен `dwgread -O json` и скрипт сверки.
- Вывод: кластеры «счётчик < отрисовки» (PolyLine2D 0/7, Constraints 0/2, Leader 9/10 и др.) из 4.2.1 **не
  разрешены** — не отличить «движок не рисует тип» от «счётчик считает по blockTable иначе». Передаётся в Э2
  как первый пункт (etalon-скрипт с JSON-dump + сверкой по handle). Сам рендер при этом жив: canvas есть,
  ошибок нет — вопрос только в метрике drawn%.

## 4.2.7 — вкладки layouts — PASS (сервер, interactions.js, sample_2018.dwg)

- Движок видит 3 layout: `*Model_Space`, `*Paper_Space`, `*Paper_Space0`; панель `#layoutTabs` видима,
  3 кнопки `.stab`; активна «Model» (`aria-selected=true`).
- Клик по «*Paper_Space»: `aria-selected` перешёл на неё, `engine.activeLayoutBtrId()` сменился
  (`btrSwitch:true`), canvas остался жив (`canvasStill:true`), `ok:true`.
- Дословно: `ROW {"check":"4.2.7-layout-tabs",...,"tabCount":3,"btrSwitch":true,"selSwitch":true,"canvasStill":true,"ok":true}`

## 4.2.9 — link flow больших файлов — FAIL (детерминированный)

- 20MB синтетика (size_20mb.dwg, 10645 KB) через DNR-redirect: **2 прогона из 2 — таймаут** (OPEN_TIME_LIMIT_S=60,
  карточка «This drawing is too large to open here» — продукт отработал корректно, не креш).
- Тот же файл через fileInput — **PASS 6794ms** (см. 4.2.4). То есть парсер тянет файл; падает именно link-путь.
- Диагностика (diag-link.js, тики каждые 2с): для синтетики counts всегда 0/0 (норма, счётчик по blockTable),
  `processing:true` держится до таймаута; heap замирает ровно на ~50 MB — прогресса парсинга не видно.
- Подозреваемые (Э2): (1) mtext-воркер фетчит `fonts/fonts.json` ~30 раз на мелкий файл — на большом файле
  churn растёт; (2) двойная доставка документа в движок через link-путь (fetch→ArrayBuffer→transfer).
- Малый файл через link — PASS (см. 4.2.10), т.е. путь работает, вопрос масштабирования.

## 4.2.10 — link flow cookies/DNR — PASS (mechanics, small)

- Прогон `open-link.js sample_2018.dwg` (19KB): навигация на `http://127.0.0.1:<port>/sample_2018.dwg`
  → DNR-правило редиректит main_frame на `chrome-extension://…/src/viewer/viewer.html#raw=<url>`
  (`urlIsExtension:true`, `rawInUrl:true`).
- Viewer открыл файл: `ok:true`, drawn 6/6, `ms_open:1024`; сервер видел ровно один fetch
  (cookie/authorization/origin пишутся в serverLog — формат для сверки с прод-ссылками; в стенде куки нет).
- Внешних запросов 0, кроме самого источника на localhost (`extRequests:2` — main_frame + fetch воркера на 127.0.0.1); CSP 0.
- Дословно: `ROW {"file":"sample_2018.dwg","sizeKB":19,"mode":"dnr-redirect","ok":true,"total":6,"drawn":6,"layouts":3,"hasCanvas":true,"ms_open":1024,"ms_total":1041,"finalUrl":"chrome-extension://chjnnacclclmmjgeljppiihomfdnldcd/src/viewer/viewer.html#raw=http://127.0.0.1:53828/sample_2018.dwg","urlIsExtension":true,"rawInUrl":true,"heapPeakMB":31,"cookies":[],"serverSaw":[{"url":"/sample_2018.dwg","cookie":null,"authorization":null,"origin":null}],"csp":0,"extRequests":2}` (`WROTE …open-link-small4b.json rows=1`, `EXIT 0 chromes_left=0`)
- Замечание: ранний прогон small3 (тот же файл) дал таймаут-карточку — флак холодного старта
  (fonts.json churn воркера); два последующих прогона — PASS, см. 4.2.9 про churn.

## 4.2.11 — Ctrl+O — PASS

- `page.keyboard` Ctrl+O на открытой странице viewer → `page.waitForFileChooser` сработал
  (`fileChooser:true`), native chooser не открыт (Puppeteer перехватывает). В продукте — слушатель
  Ctrl+O вызывает тот же `#fileInput.click()`.

## 4.2.12 — Alt+Shift+D — PASS (статически; manual для браузерной части)

- Манифест: `commands._execute_action.suggested_key.default = "Alt+Shift+D"`; в SW есть
  `chrome.action.onClicked.addListener` (`actionOnClickedaHandler:true`) → клик по иконке открывает viewer.
- Ограничение харнесса: CDP `Input.dispatchKeyEvent` идёт в страницу, а не в браузер — браузерные
  команды не эмулируются. Ручной шаг: `chrome://extensions/shortcuts` показывает Alt+Shift+D.

## 4.2.13 — печать — PASS c гэпом @page

- `page.pdf({printBackground:true})`: **89380 байт**, магия `%PDF-` подтверждена, canvas в DOM (1280×782).
- Заголовок вкладки: `sample_2018.dwg · DWG Viewer` — имя файла присутствует (`titleHasName:true`).
- **Гэп vs ТЗ**: в `src/viewer/viewer.css` нет `@page` и `@media print` правил (для полей/скрытия UI при печати).
  Содержимое canvas в PDF не ассерилось (растеризация canvas при печати зависит от GPU/printBackground —
  на сервере swiftshader). Задача на Э2: добавить `@page { margin: ... }` + `@media print { скрыть тулбар }`.

## 4.2.14 — инкогнито — manual-only

- В манифесте ключа `incognito` нет → default `"spanning"` (страницы расширения открываются в
  инкогнито-окне, но данные изолированы).
- Грант «Allow in incognito» — юзерский тумблер в `chrome://extensions → Details`, из CDP недоступен:
  без него расширение в инкогнито-контексте не запускается вовсе, автоматизировать нечем.
- Ручной шаг для Аны: chrome://extensions → DWG Viewer → Details → Allow in incognito.

## Предложения по константам (для решения Аны)

- `{oldest} = AC1014` — подтвердить. Корпус дал ok≥2 на каждую из 7 версий AC1014–AC1032; старше — гейт
  чистой карточкой. Решение-поинт: DXF-гейта в ТЗ нет (DXF r9–r13 открываются, 55/55) — если нужен
  единый пол (`oldest` и для DXF), это правка `src/lib/version-gate.js`, не харнесса.
- `{newest} = AC1032` — подтвердить (верх корпуса, 29/29 ok).
- `OPEN_TIME_LIMIT_S = 60` — оставить: 20MB через fileInput открывается за 6.8с (запас ×8.8).
- `LINK_LIMIT_MB = 100` — оставить как капу потока, но **вопрос Э1**: файлы ≥20MB через link не
  успевают за 60с (4.2.9 FAIL) — либо чинить link-путь (Э2), либо честно документировать ограничение
  «link рекомендуется до ~10MB».

## Ограничения прогона (честно)

- 4.2.8 (прогресс/статус-бар) — не проверена: нет скрипта в этом запуске; UI-прогресс наблюдается в
  скриншотах corpus/link, ассерта нет. → Э2 или ручная проверка.
- 50MB-тир 4.2.4 — фикстура не готова: локальный `dxf2dwg --as r2000` на size_50mb.dxf упёрся в
  таймаут 3600с (subprocess.TimeoutExpired) — генерация требует >1ч CPU. Для Э2: генерить на сервере
  или снизить целевой размер; прогресс-лог генератора — tools/e2e/fixtures/gen_sizes.py.
- 4.2.13: содержимое canvas в PDF не ассерилось; 4.2.14/4.2.12 — юзерские тумблеры, manual-only.
