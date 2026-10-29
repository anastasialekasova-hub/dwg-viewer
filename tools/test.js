// Unit tests runnable in plain Node (ТЗ 10): settings migration, link
// matching, file-format sniffing, card 4 response classification. The review
// widget (F-27) and background colors get their tests with their modules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SETTINGS_DEFAULTS, migrateSettings } from '../src/lib/settings.js';
import { isDrawingUrl } from '../src/lib/links-match.js';
import { VERSION_CODES, dwgVersion, dxfVersion, sniffKind } from '../src/lib/format.js';
import {
  LINK_LIMIT_BYTES,
  classifyLinkStatus,
  isHtmlContentType,
  looksLikeHtml,
  isOverLinkLimit,
} from '../src/lib/link-classify.js';

let n = 0;
const failed = [];
const run = (label, fn) => {
  n++;
  try {
    fn();
  } catch (err) {
    failed.push(`${label}: ${err.message}`);
  }
};
const enc = (s) => new TextEncoder().encode(s);
const SENTINEL = 'AutoCAD Binary DXF\r\n\x1a\x00';

/* ---------- migrateSettings ---------- */

run('migrate: null/ junk → defaults', () => {
  assert.deepEqual(migrateSettings(null), SETTINGS_DEFAULTS);
  assert.deepEqual(migrateSettings('x'), SETTINGS_DEFAULTS);
  assert.deepEqual(migrateSettings(42), SETTINGS_DEFAULTS);
  assert.deepEqual(migrateSettings({}), SETTINGS_DEFAULTS);
});

run('migrate: wrong types fall back to defaults', () => {
  const out = migrateSettings({
    interceptLinks: 'yes',
    background: 'blue',
    hintSeen: 1,
    linkNoticeSeen: 'x',
  });
  assert.deepEqual(out, SETTINGS_DEFAULTS);
});

run('migrate: valid values pass through, junk and version dropped', () => {
  const out = migrateSettings({
    version: 0,
    interceptLinks: false,
    background: 'light',
    hintSeen: true,
    linkNoticeSeen: true,
    junk: 'x',
  });
  assert.deepEqual(out, {
    version: 1,
    interceptLinks: false,
    background: 'light',
    hintSeen: true,
    linkNoticeSeen: true,
  });
});

run('migrate: partial patch keeps defaults for the rest', () => {
  const out = migrateSettings({ hintSeen: true });
  assert.equal(out.hintSeen, true);
  assert.equal(out.interceptLinks, SETTINGS_DEFAULTS.interceptLinks);
  assert.equal(out.background, SETTINGS_DEFAULTS.background);
});

/* ---------- isDrawingUrl (7.4) ---------- */

run('isDrawingUrl: drawing links', () => {
  for (const u of [
    'http://site.t/part.dwg',
    'https://site.t/a/b/part.dxf',
    'https://site.t/part.dwg?download=1',
    'https://site.t/part.dxf#top',
    'https://site.t/PART.DWG',
    'https://site.t/files%2Fpart.dwg',
  ]) {
    assert.equal(isDrawingUrl(u), true, u);
  }
});

run('isDrawingUrl: non-drawing links', () => {
  for (const u of [
    'ftp://site.t/part.dwg',
    'chrome-extension://abc/viewer.html',
    'file:///c/part.dwg',
    'https://site.t/part',
    'https://site.t/part.dwgx',
    'https://site.t/file?name=part.dwg',
    'https://site.t/',
    'not a url',
    '',
  ]) {
    assert.equal(isDrawingUrl(u), false, u);
  }
});

/* ---------- format.js: DWG versions ---------- */

const DWG_CASES = [
  ['AC1006', 'R10', false],
  ['AC1009', 'R11/R12', false],
  ['AC1012', 'R13', false],
  ['AC1014', 'R14', true],
  ['AC1015', '2000', true],
  ['AC1018', '2004', true],
  ['AC1021', '2007', true],
  ['AC1024', '2010', true],
  ['AC1027', '2013', true],
  ['AC1032', '2018', true],
];

run('dwgVersion: every known code', () => {
  for (const [code, name, supported] of DWG_CASES) {
    assert.deepEqual(dwgVersion(enc(`${code}sponsor`)), { code, name, supported }, code);
    assert.equal(VERSION_CODES[code], name, code);
  }
});

run('dwgVersion: garbage and short input', () => {
  assert.equal(dwgVersion(enc('ABCDEF')), null);
  assert.equal(dwgVersion(enc('AC10')), null);
  assert.equal(dwgVersion(new Uint8Array(0)), null);
  assert.equal(dwgVersion(null), null);
});

/* ---------- format.js: DXF versions ---------- */

run('dxfVersion: ASCII with $ACADVER', () => {
  const t = (code) => enc(`0\nSECTION\n  2\n$ACADVER\n   1\n${code}\n  0\nENDSEC\n`);
  assert.deepEqual(dxfVersion(t('AC1018')), { code: 'AC1018', name: '2004', supported: true });
  assert.deepEqual(dxfVersion(t('AC1014')), { code: 'AC1014', name: 'R14', supported: true });
  assert.deepEqual(dxfVersion(t('AC1009')), { code: 'AC1009', name: 'R11/R12', supported: false });
  assert.deepEqual(dxfVersion(t('AC1032')), { code: 'AC1032', name: '2018', supported: true });
});

run('dxfVersion: ASCII without $ACADVER → unknown but accepted', () => {
  assert.deepEqual(dxfVersion(enc('0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n')), {
    code: null,
    name: null,
    supported: true,
  });
});

run('dxfVersion: binary sentinel, version at offset 22', () => {
  const b = (tail) => enc(SENTINEL + tail);
  assert.deepEqual(dxfVersion(b('AC1015')), { code: 'AC1015', name: '2000', supported: true });
  assert.deepEqual(dxfVersion(b('AC1006')), { code: 'AC1006', name: 'R10', supported: false });
  assert.deepEqual(dxfVersion(b('XXXXXX')), { code: null, name: null, supported: true });
  // 21 bytes: too short for the sentinel check → falls to the ASCII path,
  // which accepts it as an (unparseable) DXF rather than rejecting.
  assert.deepEqual(dxfVersion(enc(SENTINEL.slice(0, 21))), { code: null, name: null, supported: true });
  assert.equal(dxfVersion(enc(SENTINEL)), null); // 22 bytes < 28: no version room
});

run('dxfVersion: garbage → unknown but accepted', () => {
  assert.deepEqual(dxfVersion(enc('this is not a drawing at all')), {
    code: null,
    name: null,
    supported: true,
  });
  assert.equal(dxfVersion(enc('999')), null); // too short
  assert.equal(dxfVersion(null), null);
});

/* ---------- sniffKind ---------- */

run('sniffKind: magic bytes first, name as fallback', () => {
  assert.equal(sniffKind(enc('AC1018xyz'), 'x.txt'), 'dwg');
  assert.equal(sniffKind(enc('0\nSECTION'), 'x.txt'), 'dxf');
  assert.equal(sniffKind(enc(SENTINEL + 'AC1015'), 'x.txt'), 'dxf');
  assert.equal(sniffKind(enc('junk'), 'x.DWG'), 'dwg');
  assert.equal(sniffKind(enc('junk'), 'x.dxf'), 'dxf');
  assert.equal(sniffKind(enc('junk'), 'x.txt'), null);
  assert.equal(sniffKind(null, 'x.dwg'), 'dwg');
  assert.equal(sniffKind(null, 'x.zip'), null);
});

/* ---------- link classification (card 4, 7.5) ---------- */

run('classifyLinkStatus: 401/403 → auth, other non-2xx → generic, 2xx → null', () => {
  assert.equal(classifyLinkStatus(401), 'auth');
  assert.equal(classifyLinkStatus(403), 'auth');
  assert.equal(classifyLinkStatus(200), null);
  assert.equal(classifyLinkStatus(204), null);
  assert.equal(classifyLinkStatus(404), 'generic');
  assert.equal(classifyLinkStatus(500), 'generic');
});

run('isHtmlContentType', () => {
  assert.equal(isHtmlContentType('text/html; charset=utf-8'), true);
  assert.equal(isHtmlContentType('Text/HTML'), true);
  assert.equal(isHtmlContentType('application/octet-stream'), false);
  assert.equal(isHtmlContentType('image/vnd.dwg'), false);
  assert.equal(isHtmlContentType(null), false);
});

run('looksLikeHtml: body sniff catches mislabeled login pages', () => {
  assert.equal(looksLikeHtml(enc('<!DOCTYPE html><html>')), true);
  assert.equal(looksLikeHtml(enc('  <html><body>sign in')), true);
  assert.equal(looksLikeHtml(enc('<!doctype HTML>')), true);
  assert.equal(looksLikeHtml(enc('AC1016binary-ish')), false);
  assert.equal(looksLikeHtml(enc('%!PS')), false);
});

run('link size limit: 100 MB decimal, boundary inclusive', () => {
  assert.equal(LINK_LIMIT_BYTES, 100 * 1e6);
  assert.equal(isOverLinkLimit(0), false);
  assert.equal(isOverLinkLimit(100 * 1e6), false);
  assert.equal(isOverLinkLimit(100 * 1e6 + 1), true);
});

/* ---------- vendor fit patch (4.2.1, F-8) ---------- */

{
  const vendor = readFileSync(new URL('../src/vendor/cad-viewer.js', import.meta.url), 'utf8');
  run('fit patch: smart-fit boxes skip the XLINE / RAY exclusion set', () => {
    assert.ok(vendor.includes('// DWG Viewer patch: fit extents'));
    assert.ok(vendor.includes('filter((o) => Ke2(o) && !x.has(o.id))'));
    assert.ok(vendor.includes('Ke2(o) && !this._extentExcludedObjectIds.has(o.id) && i.push(o)'));
    assert.ok(vendor.includes('const t = await Mb(__dwvDropOutliers(s), e);'));
  });
  run('print patch: engine renderer keeps its drawing buffer (4.2.13)', () => {
    assert.ok(vendor.includes('/* DWG Viewer patch: print buffer */ preserveDrawingBuffer: true'));
  });
  run('engine UI off: command line and toolbars hidden, session-only', () => {
    const eng = readFileSync(new URL('../src/viewer/engine.js', import.meta.url), 'utf8');
    for (const k of ['isShowCommandLine', 'isShowToolbar', 'isShowShortCutToolbar', 'isShowRibbon']) {
      assert.ok(new RegExp(k + ': false').test(eng), k);
    }
    assert.ok(eng.includes('{ persist: false }'));
  });
  const at = vendor.indexOf('function __dwvDropOutliers(boxes) {');
  const end = vendor.indexOf('\n}\n', at) + 2;
  const drop = new Function(`${vendor.slice(at, end)}; return __dwvDropOutliers;`)();
  const box = (x, y, w = 10, h = 10) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });
  // acadsharp sample layout: ~150 boxes in x 0..1852, y -566..111
  const core = Array.from({ length: 150 }, (_, i) => box((i * 37) % 1840, -560 + ((i * 53) % 660)));
  run('fit patch: far box and ±1e6 segment are dropped, core kept', () => {
    const far = box(5e6, 5e6);
    const huge = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
    const out = drop([...core, far, huge]);
    assert.equal(out.length, core.length);
    assert.ok(!out.includes(far) && !out.includes(huge));
  });
  run('fit patch: under 20 boxes nothing is dropped', () => {
    const few = [...core.slice(0, 10), box(5e6, 5e6)];
    assert.equal(drop(few).length, few.length);
  });
  run('fit patch: a second cluster with over 2 % of boxes stays', () => {
    const second = Array.from({ length: 10 }, (_, i) => box(50000 + i * 20, 0));
    assert.equal(drop([...core, ...second]).length, core.length + second.length);
  });
}

/* ---------- report ---------- */

for (const f of failed) console.log(`FAIL ${f}`);
console.log(`${n - failed.length}/${n} passed`);
process.exit(failed.length ? 1 : 0);
