// Repo guard (ТЗ 10): manifest paths and exact permissions, locale set and
// format, vendor license headers, no key material, viewer id wiring.
// `--release` additionally fails while the listing description and the
// {oldest}/{newest} range are placeholders.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGES, TEMP_EXT_DESCRIPTION } from './i18n/schema.js';
import { RANGE_VERIFIED } from '../src/lib/format.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) errors.push(label);
};
const readJson = async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8'));

/* ---------- manifest ---------- */

const manifest = await readJson('manifest.json');

check(manifest.manifest_version === 3, 'manifest: MV3');
check(manifest.minimum_chrome_version === '116', 'manifest: minimum_chrome_version 116');
check(manifest.default_locale === 'en', 'manifest: default_locale en');
check(
  manifest.content_security_policy?.extension_pages ===
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  'manifest: CSP extension_pages exact',
);

const EXPECTED_PERMISSIONS = ['storage', 'contextMenus', 'scripting', 'declarativeNetRequestWithHostAccess'];
const EXPECTED_HOSTS = ['http://*/*', 'https://*/*'];
const FORBIDDEN = ['tabs', 'downloads', 'webNavigation', 'webRequest', 'activeTab', 'notifications', 'unlimitedStorage', 'offscreen'];
check(
  JSON.stringify([...(manifest.permissions ?? [])].sort()) === JSON.stringify([...EXPECTED_PERMISSIONS].sort()),
  'manifest: permissions exactly 6.4 list',
  JSON.stringify(manifest.permissions),
);
check(
  JSON.stringify([...(manifest.host_permissions ?? [])].sort()) === JSON.stringify([...EXPECTED_HOSTS].sort()),
  'manifest: host_permissions exactly http/https any',
);
check(
  FORBIDDEN.every((f) => !(manifest.permissions ?? []).includes(f) && !(manifest.host_permissions ?? []).includes(f)),
  'manifest: no forbidden permissions',
);

const relPaths = [
  ...Object.values(manifest.icons ?? {}),
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? []),
  ...(manifest.action?.default_icon ? Object.values(manifest.action.default_icon) : []),
  ...(manifest.web_accessible_resources ?? []).flatMap((war) => war.resources ?? []).filter((r) => !r.includes('*')),
].filter(Boolean);
check(
  relPaths.every((p) => existsSync(path.join(root, p))),
  'manifest: every referenced path exists',
  relPaths.filter((p) => !existsSync(path.join(root, p))).join(', '),
);

/* ---------- locales ---------- */

const EN_KEYS = Object.keys(MESSAGES);
const LOCALES = (await readdir(path.join(root, '_locales'))).sort();
check(LOCALES.length === 53, '_locales: exactly 52 locales + nb', `got ${LOCALES.length}`);

const en = await readJson('_locales/en/messages.json');
check(
  Object.keys(en).length === EN_KEYS.length && EN_KEYS.every((k) => k in en),
  '_locales/en: keys match the schema exactly',
);
check(
  `${en.extDescription?.message ?? ''}`.length <= 132,
  '_locales/en: extDescription ≤ 132 chars',
);

let localesOk = true;
let localeDetail = '';
for (const loc of LOCALES) {
  const m = await readJson(`_locales/${loc}/messages.json`);
  const keys = Object.keys(m);
  const allowed = ['extName', 'extDescription'];
  if (loc === 'en') continue;
  if (!keys.every((k) => allowed.includes(k)) || !('extName' in m) || !('extDescription' in m)) {
    localesOk = false;
    localeDetail = `${loc}: keys ${keys.join(',')}`;
    break;
  }
  if (!m.extName?.message || !m.extDescription?.message) {
    localesOk = false;
    localeDetail = `${loc}: empty extName/extDescription`;
    break;
  }
  if (m.extName.message !== en.extName.message) {
    localesOk = false;
    localeDetail = `${loc}: extName differs from en (translations land with the listing)`;
    break;
  }
  if (`${m.extDescription.message}`.length > 132) {
    localesOk = false;
    localeDetail = `${loc}: extDescription > 132 chars`;
    break;
  }
}
check(localesOk, '_locales: non-en carry only extName/extDescription, ≤ 132 chars', localeDetail);

const no = await readJson('_locales/no/messages.json');
const nb = await readJson('_locales/nb/messages.json');
check(JSON.stringify(no) === JSON.stringify(nb), '_locales: nb is a copy of no');

/* ---------- vendor headers ---------- */

const VENDOR = 'src/vendor';
for (const f of (await readdir(path.join(root, VENDOR))).sort()) {
  if (f.endsWith('.js')) {
    const head = await readFile(path.join(root, VENDOR, f), 'utf8').then(
      (t) => t.slice(0, 600),
    );
    check(
      head.includes('Package:') && head.includes('License:'),
      `vendor: ${f} header has Package/License`,
    );
  } else if (f.endsWith('.wasm')) {
    const notices = await readFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    check(notices.includes(`## ${f}`), `vendor: ${f} covered in THIRD_PARTY_NOTICES.md`);
  }
}

/* ---------- no key material ---------- */

const pem = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.venv' || e.name === 'fixtures-local') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (/\.(pem|key|p12|pfx)$/i.test(e.name)) pem.push(path.relative(root, p));
  }
}
await walk(root);
check(pem.length === 0, 'no key/cert files in the repo', pem.join(', '));

/* ---------- viewer wiring ---------- */

const viewerHtml = await readFile(path.join(root, 'src/viewer/viewer.html'), 'utf8');
const viewerJs = await readFile(path.join(root, 'src/viewer/viewer.js'), 'utf8');
const htmlIds = new Set([...viewerHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const used = [
  ...[...viewerJs.matchAll(/els\.([A-Za-z0-9_]+)/g)].map((m) => m[1]),
  ...[...viewerJs.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]),
];
const missing = [...new Set(used)].filter((id) => !htmlIds.has(id));
check(missing.length === 0, 'viewer: every els.* id exists in viewer.html', missing.join(', '));

/* ---------- --release gates ---------- */

if (process.argv.includes('--release')) {
  check(
    en.extDescription.message !== TEMP_EXT_DESCRIPTION,
    '--release: extDescription is the final listing text (not the temporary line)',
  );
  check(RANGE_VERIFIED === true, '--release: {oldest}/{newest} verified on the 4.2.1 corpus');
}

console.log(errors.length ? `validate: ${errors.length} failed` : 'validate: all green');
process.exit(errors.length ? 1 : 0);
