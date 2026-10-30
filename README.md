# DWG Viewer (MV3)

Локальный просмотр DWG/DXF в Chrome. Нуль сетевых запросов: движок (LibreDWG WASM,
vendored) и все данные — on-extension. Подробности архитектуры — `src/`, сборка
vendor-движка — `tools/vendor-build.js`.

## Э1 тест-харнесс (tools/e2e/e1)

Запускается на тест-сервере (Chrome for Testing, unpacked extension из корня):

```
CHROME_PATH=<chrome> node tools/e2e/e1/open-corpus.js tools/e2e/e1/manifests/corpus.json
CHROME_PATH=<chrome> node tools/e2e/e1/open-link.js <file> [--direct]
CHROME_PATH=<chrome> node tools/e2e/e1/interactions.js <dwg-with-2+-layouts>
CHROME_PATH=<chrome> node tools/e2e/e1/diag-open.js <file> [ticks]
CHROME_PATH=<chrome> node tools/e2e/e1/diag-link.js <file> [--direct]
CHROME_PATH=<chrome> node tools/e2e/e1/print.js <file>            # 4.2.12/4.2.13
CHROME_PATH=<chrome> node tools/e2e/e1/cookies.js <file> [--incognito]  # 4.2.8/4.2.14
node tools/e2e/e1/batch.js tools/e2e/e1/manifests/plan-e1b.json   # несколько шагов за один ssh-run
```

Через `remote-test.sh` весь проход — один `run` с batch.js (sshd сервера рвёт серии коротких
сессий). Перед `sync` папки `tools/.venv` и `tools/libredwg-0.14` убираются из дерева.

Артефакты → `tools/e2e/out/e1/` (JSON-rows + скриншоты), сводка —
`tools/e2e/e1-report.md` (по нумерации ТЗ 4.2.1–4.2.14).

## Корпус Э1 (ТЗ 4.2.1): 26 настоящих DWG, по 2+ на версию

Манифест `tools/e2e/e1/manifests/real.json`, эталон по типам `tools/e2e/e1/reference/real-dwgread.jsonl`
(`dwgread` LibreDWG 0.14, собран локально в `tools/libredwg-0.14`, не в git). Программа —
из AppInfo файла (у R14/R2000 AppInfo в формате нет). Типы: S=SPLINE, H=HATCH, M=MTEXT, T=TEXT,
I=INSERT, P=LWPOLYLINE, E=ELLIPSE, D=DIMENSION; «объектов» = все сущности по dwgread без BLOCK/ENDBLK/VIEWPORT.
В git лежат только файлы ACadSharp (MIT) — `tools/e2e/fixtures/acadsharp/` с `LICENSE` и эталонной
картинкой `preview.png`; остальные — в `tools/e2e/fixtures-local/` (gitignored), лицензия на
распространение не указана или не позволяет класть их в репозиторий.

| Файл | Версия | Источник | Лицензия | Программа | Типы | Объектов |
|---|---|---|---|---|---|---|
| acadsharp/sample_AC1014.dwg | AC1014 | github.com/DomCR/ACadSharp samples | MIT | AutoCAD 2025 (сохранено в R14) | S H M T I P E D | 163 |
| libredwg-testdata/example_r14.dwg | AC1014 | LibreDWG test/test-data | GPL-3.0 (проект) | AutoCAD | S H M T I P E D | 68 |
| acadsharp/sample_AC1015.dwg | AC1015 | ACadSharp samples | MIT | AutoCAD 2025 | S H M T I P E D | 163 |
| libredwg-testdata/example_2000.dwg | AC1015 | LibreDWG test-data | GPL-3.0 (проект) | AutoCAD | S H M T I P E D | 68 |
| gdal/text_mtext_attdef_r2000.dwg | AC1015 | OSGeo/gdal autotest/ogr/data/cad | MIT (GDAL) | не указана | M T | 3 |
| libredwg-written/example_2000_by_libredwg.dwg | AC1015 | LibreDWG test-data | GPL-3.0 (проект) | LibreDWG (запись) | S H M T I P E D | 68 |
| acadsharp/sample_AC1018.dwg | AC1018 | ACadSharp samples | MIT | AutoCAD 2025 | S H M T I P E D | 141 |
| libredwg-testdata/example_2004.dwg | AC1018 | LibreDWG test-data | GPL-3.0 (проект) | AutoCAD 2018 | S H M T I P E D | 68 |
| acadsharp/sample_AC1021.dwg | AC1021 | ACadSharp samples | MIT | AutoCAD 2025 | S H M T I P E D | 161 |
| mlightcad/canteen.dwg | AC1021 | github.com/mlightcad/cad-data | не указана (dwgmodels.com) | AutoCAD 2022 | S H M T I P E D | 25123 |
| mlightcad/map-of-uae.dwg | AC1021 | mlightcad/cad-data | не указана (dwgmodels.com) | AutoCAD 2022 | H M I P E | 129 |
| autodesk/architectural_-_annotation_scaling_and_multileaders.dwg | AC1021 | autodesk.com/autocad-samples | Autodesk sample files | AutoCAD 2008 | H M I P D | 1375 |
| autodesk/blocks_and_tables_-_metric.dwg | AC1021 | autodesk.com/autocad-samples | Autodesk sample files | AutoCAD 2007 | M I P | 504 |
| acadsharp/sample_AC1024.dwg | AC1024 | ACadSharp samples | MIT | AutoCAD 2025 | S H M T I P E D | 161 |
| autodesk/civil_example-imperial.dwg | AC1024 | autodesk.com/autocad-samples | Autodesk sample files | AutoCAD 2010 | I P D | 39 |
| autodesk/mechanical_example-imperial.dwg | AC1024 | autodesk.com/autocad-samples | Autodesk sample files | AutoCAD 2010 | D | 88 |
| autodesk/visualization_-_condominium_with_skylight.dwg | AC1024 | autodesk.com/autocad-samples | Autodesk sample files | AutoCAD 2011 | S I P | 73 |
| acadsharp/sample_AC1027.dwg | AC1027 | ACadSharp samples | MIT | AutoCAD 2025 | S H M T I P E D | 161 |
| gdal/Building_A_Floor_0_Mapwize.dwg | AC1027 | OSGeo/gdal autotest | MIT (GDAL) | AutoCAD 2017 | T I P | 275 |
| gdal/attribs.dwg | AC1027 | OSGeo/gdal autotest | MIT (GDAL) | ODA SDK (Teigha 22.6) | T I P | 59 |
| acadsharp/sample_AC1032.dwg | AC1032 | ACadSharp samples | MIT | AutoCAD 2025 | S H M T I P E D | 161 |
| acadsharp/export_sample.dwg | AC1032 | ACadSharp samples | MIT | AutoCAD 2025 | H M T I P E D | 70 |
| mlightcad/baseline-sample.dwg | AC1032 | mlightcad/cad-data | не указана | AutoCAD 2025 (zh-CN) | S H M T I P E | 169 |
| owerko/hatches.dwg | AC1032 | github.com/owerko/DWG_test_files | не указана | AutoCAD 2023 | H I | 16 |
| owerko/spline.dwg | AC1032 | owerko/DWG_test_files | не указана | AutoCAD 2023 | S I | 11 |
| owerko/dimensions.dwg | AC1032 | owerko/DWG_test_files | не указана | AutoCAD 2023 | I P D | 43 |

Пробел корпуса: нет файлов из BricsCAD, DraftSight, ZWCAD и LibreCAD (LibreCAD пишет только DXF);
из «не AutoCAD» есть ODA SDK (attribs.dwg) и LibreDWG (example_2000_by_libredwg.dwg).
Layout (листы) есть в файлах ACadSharp, libredwg-testdata и autodesk/*.
DXF (ТЗ 4.2.2) — `tools/e2e/e1/manifests/corpus.json`, тестовые файлы LibreDWG (56 DXF: 54 ASCII + 2 binary).
Самый большой настоящий DWG в корпусе — canteen.dwg 2,5 МБ, DXF — Dynblocks.dxf 10 МБ; публичных
настоящих DWG от 5 МБ с понятной лицензией не нашлось. Синтетика по размерам в корпус не входит.

## Регенерация фикстур

- Синтетика по размерам (DXF 1/20/50 MB): `tools/.venv/bin/python -I tools/e2e/e1/gen-sizes.py
  tools/e2e/fixtures-local/sizes2 size_1mb.dxf:7200 size_20mb.dxf:144000 size_50mb.dxf:360000`
  (ezdxf, слой SIZES объявлен в таблице LAYER; манифест `manifests/sizes2.json`).
  Синтетический DWG через LibreDWG dxf2dwg непригоден: из R2000 он пишет два *Model_Space,
  из R12 — блоки без имён, вьюер рисует пустой экран; 5 МБ конвертируется ~7 мин.
- Vendor-движок: `node tools/vendor-build.js` — esbuild-сборка + обязательные патчи
  (`tools/vendor-patch-csp.js`: 2×`new Function`; замена CDN-каталога шрифтов mtext-воркера
  на `fonts/`). Патчи падают громко при изменении upstream.
- Каталог шрифтов: `src/vendor/fonts/CadSans-subset.ttf` (сабсет DejaVu 41 КБ,
  собирается vendor-build'ом через pyftsubset; полное начертание не поставляется).

## Решения блока 2 (30.10.2026)

- **Печать (F-15).** `engine.printView()` рисует текущий вид вторым,
  внеканальным WebGLRenderer'ом в 2–2.5× размере (кап по MAX_RENDERBUFFER_SIZE)
  со светлой палитрой и возвращает dataURL; `@media print` показывает только
  лист `.sheet` с шапкой/подвалом. Живой канвас не читается вовсе: ко времени
  `beforeprint` Chrome уже сбросил его буфер (Э1 4.2.13 — пустой лист).
  Альбомная/портретная ориентация — из пропорций холста (`@page size`).
- **Светлая палитра (F-11).** Все цвета сущностей и текста идут через
  `globalThis.__dwgColorMap` (патч `tools/vendor-patch-colors.js`, пять точек);
  `src/lib/colors.js` затемняет цвет до контраста ≥4.5:1 к oklch(99.3% 0 0),
  сохраняя оттенок; маппинг идемпотентен. Юнит-тест — все 255 ACI (tools/test.js).
  Текстуры (mtext-кэш) не перекрашиваются: цвет материала там множитель.
- **Шрифт.** Полный DejaVu стоил 45 с/2428 МБ на architectural.dwg; сабсет
  (латиница+кириллица+греческий+вьетнамский+CAD-символы, 41 КБ) — 4.9 с/194 МБ.
  Изменённый шрифт не может носить имя DejaVu (лицензия Bitstream Vera) — файл
  и нейм-таблица переименованы в Cad Sans; THREE_PARTY_NOTICES поясняет.
- **Открытие на Model** (ТЗ 10.2 кейс 9): чертёж всегда открывается на Model,
  сохранённый активный лист файла — один клик по вкладке. До этого открывался
  сохранённый лист (export_sample → «dimensions»).
- **Карточка пустого чертежа** (принято Аной 30.10): `drawn === 0` — карточка
  «No visible objects in this drawing»; если ≥половины ненарисованного —
  3DSOLID, «This is a 3D model» (condominium).
- **Alt-клик.** Контент-скрипт Alt-клики пропускает (ТЗ F-18), но DNR-правило
  (F-25) перехватывает саму навигацию — файл открывается во вьюере вместо
  скачивания; восстановление — «Download original» в полосе источника.
  Отличие от нативного поведения записано в отчёт блока 2.
- **`OPEN_TIME_LIMIT_S` = 60**; `LINK_LIMIT_MB = 20` (решение Аны по Э1,
  перемер после сабсета: syn_20mb.dxf по ссылке — см. отчёт).
- **Fit на открытии** ждёт стабилизации счётчика нарисованного (два равных
  чтения по 250 мс), потом Fit — example_r14 раньше вписывался по частичным
  границам. Индикатор масштаба — доля пикселей на мировую единицу против
  базовой после Fit (camera.zoom не меняется при zoomTo — всегда «100%»).

## Константы

`src/lib/config.js`: `LINK_LIMIT_MB = 20`; `OPEN_TIME_LIMIT_S` = 60 —
используется viewer'ом как дедлайн открытия, тест-харнесс читает тот же лимит.
