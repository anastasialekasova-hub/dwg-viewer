#!/usr/bin/env bash
# Builds the Chrome Web Store upload zip (ТЗ 7.2 / Э4): white-listed contents
# only — manifest, src, icons, _locales, LICENSE, THIRD_PARTY_NOTICES.md,
# VERSION — with the gate scripts green first and sizes printed at the end.
# No node_modules, no .git, no fixtures, no e2e out, no key files (validate
# also guards the latter). Distribution license: GPL-3.0-or-later (ТЗ 7.9).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/manifest.json').version")"
OUT="$ROOT/dist"
ZIP="$OUT/dwg-viewer-$VERSION.zip"

cd "$ROOT"
node tools/validate.js > /dev/null
node tools/validate.js --release > /dev/null
node tools/test.js > /dev/null

mkdir -p "$OUT"
rm -f "$ZIP"
zip -rq "$ZIP" manifest.json src icons _locales LICENSE THIRD_PARTY_NOTICES.md VERSION \
  -x '*.DS_Store' '*/.*'

echo "$ZIP"
unzip -l "$ZIP" | tail -1
ls -la "$ZIP" | awk '{print "bytes:", $5}'
