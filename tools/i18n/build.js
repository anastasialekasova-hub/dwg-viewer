// Generates _locales/ from schema.js and the translation tables
// (tools/i18n/translations/*.js, listing-translator party). `en` carries every
// key; other locales carry only extName (English "DWG Viewer" — national names
// arrive at stage 6) and extDescription (translated, ≤132 chars). `nb` is an
// exact copy of `no`.
// Literal "$1"-style placeholders are stored escaped ("$$1") so Chrome's
// messages.json parser passes them through; getMessage() unescapes "$$" to "$".
import { mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { MESSAGES } from './schema.js';

const LOCALES = [
  'en', 'es', 'es_419', 'pt_BR', 'pt_PT', 'ca', 'fr', 'it', 'ro', 'de', 'nl',
  'sv', 'da', 'no', 'fi', 'et', 'pl', 'ru', 'uk', 'cs', 'sk', 'sl', 'hr',
  'sr', 'bg', 'lt', 'lv', 'hu', 'el', 'tr', 'ar', 'fa', 'he', 'am', 'sw',
  'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'id', 'ms', 'vi', 'th',
  'fil', 'ja', 'ko', 'zh_CN', 'zh_TW',
];

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', '..', '_locales');
const tablesDir = path.join(here, 'translations');

// The tables are ESM (package type: module) with one named export per locale;
// require(esm) returns the module namespace, which iterates the same way.
const require = createRequire(import.meta.url);

async function loadTables() {
  const merged = new Map();
  const files = (await readdir(tablesDir)).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const table = require(path.join(tablesDir, f));
    for (const [loc, entry] of Object.entries(table)) {
      if (!LOCALES.includes(loc)) throw new Error(`${f}: unknown locale ${loc}`);
      if (merged.has(loc)) throw new Error(`${loc}: already in another table`);
      const desc = entry?.extDescription;
      if (typeof desc !== 'string' || !desc || desc.length > 132) {
        throw new Error(`${f}/${loc}: extDescription missing or > 132 chars`);
      }
      merged.set(loc, desc);
    }
  }
  const missing = LOCALES.filter((l) => l !== 'en' && !merged.has(l));
  if (missing.length) throw new Error(`no translation for: ${missing.join(', ')}`);
  return merged;
}

const escapeDollar = (text) => text.replace(/\$/g, '$$');

const descriptions = await loadTables();
await rm(outDir, { recursive: true, force: true });
for (const loc of LOCALES) {
  const keys = loc === 'en' ? Object.keys(MESSAGES) : ['extName', 'extDescription'];
  const json = {};
  for (const key of keys) {
    const text = key === 'extDescription' && loc !== 'en' ? descriptions.get(loc) : MESSAGES[key];
    json[key] = { message: escapeDollar(text) };
  }
  const dir = path.join(outDir, loc);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'messages.json'), JSON.stringify(json, null, 2) + '\n');
}
const no = JSON.parse(await readFile(path.join(outDir, 'no', 'messages.json'), 'utf8'));
await mkdir(path.join(outDir, 'nb'), { recursive: true });
await writeFile(path.join(outDir, 'nb', 'messages.json'), JSON.stringify(no, null, 2) + '\n');
console.log(`_locales: ${LOCALES.length} locales generated from schema + ${descriptions.size} translated extDescriptions, nb copied from no`);
