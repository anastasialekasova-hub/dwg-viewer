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
```

Артефакты → `tools/e2e/out/e1/` (JSON-rows + скриншоты), сводка —
`tools/e2e/out/e1/e1-report.md`.

## Корпус (198 файлов)

Манифест `tools/e2e/e1/manifests/corpus.json`. Источник: `tools/e2e/fixtures-local/libredwg-testdata/`
— тестовые файлы LibreDWG (GPL-проект, файлы — примеры пользователей/тестовые фикстуры;
см. `THIRD_PARTY_NOTICES.md`). По версиям: AC1015×33, AC1018×29, AC1032×29, AC1027×25,
AC1024×24, AC1021×23, AC1009×9, AC1014×7, AC1006×4, AC1003×4, AC1004×2, AC1012×3, DXF×6
(включая старые r9–r13). Типы сущностей в корпусе — типовой набор AutoCAD (LINE, ARC,
CIRCLE, LWPOLYLINE, TEXT/MTEXT, DIMENSION, LEADER, HATCH, INSERT…). Синтетика
(`tools/e2e/fixtures-local/sizes/`) — dxf2dwg из LibreDWG, в «≥20 реальных» не входит.

## Регенерация фикстур

- Синтетика по размерам (1/5/20/50 MB): генератор dxf2dwg на сервере
  (`node tools/e2e/e1/gen-sizes.js` в сценарии синка; выход `tools/e2e/fixtures-local/sizes/size_*.dwg`).
- Vendor-движок: `node tools/vendor-build.js` — esbuild-сборка + обязательные патчи
  (`tools/vendor-patch-csp.js`: 2×`new Function`; замена CDN-каталога шрифтов mtext-воркера
  на `fonts/`). Патчи падают громко при изменении upstream.
- Каталог шрифтов: `src/vendor/fonts/fonts.json` = `[]` (шрифты не поставляются).

## Константы

`src/lib/config.js`: `LINK_LIMIT_MB = 100`; `OPEN_TIME_LIMIT_S` (env) = 60 —
используется viewer'ом как дедлайн открытия, тест-харнесс читает тот же лимит.
