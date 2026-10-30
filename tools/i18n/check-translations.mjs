// Validates the listing-translator party (ТЗ 10.2): every non-en locale of
// the package covered exactly once across tools/i18n/translations/*.js, each
// carrying only `extDescription`, 1..132 chars, no line breaks, no "$" risk.
//   node tools/i18n/check-translations.mjs
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'translations');

const NON_EN = [
  'es', 'es_419', 'pt_BR', 'pt_PT', 'ca', 'fr', 'it', 'ro', 'de', 'nl',
  'sv', 'da', 'no', 'fi', 'et', 'pl', 'ru', 'uk', 'cs', 'sk', 'sl', 'hr',
  'sr', 'bg', 'lt', 'lv', 'hu', 'el', 'tr', 'ar', 'fa', 'he', 'am', 'sw',
  'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'id', 'ms', 'vi', 'th',
  'fil', 'ja', 'ko', 'zh_CN', 'zh_TW',
];

const errors = [];
const seen = new Map();
let files = 0;
try {
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.js')) continue;
    files++;
    const table = require(path.join(dir, f));
    if (!table || typeof table !== 'object') {
      errors.push(`${f}: not an object`);
      continue;
    }
    for (const [loc, entry] of Object.entries(table)) {
      if (!NON_EN.includes(loc)) {
        errors.push(`${f}: unexpected locale ${loc}`);
        continue;
      }
      if (seen.has(loc)) {
        errors.push(`${loc}: in ${seen.get(loc)} and ${f}`);
        continue;
      }
      seen.set(loc, f);
      const keys = Object.keys(entry ?? {});
      if (keys.length !== 1 || keys[0] !== 'extDescription') {
        errors.push(`${f}/${loc}: keys ${keys.join(',')} — only extDescription allowed (UI strings stay English)`);
      }
      const text = entry?.extDescription;
      if (typeof text !== 'string' || text.length === 0) {
        errors.push(`${f}/${loc}: empty extDescription`);
      } else {
        if (text.length > 132) errors.push(`${f}/${loc}: ${text.length} chars > 132`);
        if (/[\n\r]/.test(text)) errors.push(`${f}/${loc}: line break`);
        if (/\$\d/.test(text)) errors.push(`${f}/${loc}: unresolved $n placeholder`);
      }
    }
  }
} catch (e) {
  errors.push(`read failed: ${String(e).slice(0, 200)}`);
}
const missing = NON_EN.filter((l) => !seen.has(l));
if (missing.length) errors.push(`missing locales: ${missing.join(', ')}`);

for (const e of errors) console.log(`FAIL ${e}`);
console.log(`${files} files, ${seen.size}/${NON_EN.length} locales, ${errors.length} errors`);
process.exit(errors.length ? 1 : 0);
