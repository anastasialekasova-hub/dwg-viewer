// Generates _locales/ from schema.js. `en` carries every key; other locales
// carry only extName/extDescription (same English text) until the listing
// translations land (ТЗ 8). `nb` is an exact copy of `no`.
// Literal "$1"-style placeholders are stored escaped ("$$1") so Chrome's
// messages.json parser passes them through; getMessage() unescapes "$$" to "$".
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const escapeDollar = (text) => text.replace(/\$/g, '$$');

await rm(outDir, { recursive: true, force: true });
for (const loc of LOCALES) {
  const keys = loc === 'en' ? Object.keys(MESSAGES) : ['extName', 'extDescription'];
  const json = {};
  for (const key of keys) json[key] = { message: escapeDollar(MESSAGES[key]) };
  const dir = path.join(outDir, loc);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'messages.json'), JSON.stringify(json, null, 2) + '\n');
}
const no = JSON.parse(await readFile(path.join(outDir, 'no', 'messages.json'), 'utf8'));
await mkdir(path.join(outDir, 'nb'), { recursive: true });
await writeFile(path.join(outDir, 'nb', 'messages.json'), JSON.stringify(no, null, 2) + '\n');
console.log(`_locales: ${LOCALES.length} locales generated, nb copied from no`);
