// Open every manifest file in a fresh viewer page (ТЗ 4.2.1–4.2.4, 4.2.5,
// 4.2.6): success flags, counters, missed data, layouts, heap peak, console
// CSP/pageerror capture, external-request capture, screenshot per file.
//   CHROME_PATH=... node tools/e2e/e1/open-corpus.js <manifest.json> [--tag <label>]
import fs from 'node:fs';
import path from 'node:path';
import {
  launchWithExtension,
  extensionId,
  viewerPage,
  armPage,
  engineSnapshot,
  cspViolations,
  externalRequests,
  finish,
  ensureOut,
  safeName,
  OPEN_LIMIT_S,
} from './lib.js';

const manifestPath = process.argv[2];
const tagIdx = process.argv.indexOf('--tag');
const tag = tagIdx > -1 ? process.argv[tagIdx + 1] : '';
const files = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const browser = await launchWithExtension();
const extId = await extensionId(browser);
const shots = ensureOut('screens');
const rows = [];

for (const f of files) {
  const abs = path.join(process.cwd(), f.path);
  const capture = {};
  const page = await viewerPage(browser, extId, capture);
  await armPage(page);
  const t0 = Date.now();
  const row = {
    name: f.name,
    path: f.path,
    code: f.code ?? f.kind ?? '?',
    sizeKB: Math.round(f.bytes / 1024),
  };
  try {
    const chooser = await page.waitForSelector('#fileInput', { timeout: 10000 });
    await page.evaluate(() => {
      window.__openStart = performance.now();
    });
    await chooser.uploadFile(abs);
    const done = await page.waitForFunction(
      () => {
        const ok = document.getElementById('drawnPill');
        const err = document.getElementById('error');
        return (ok && !ok.hidden) || (err && !err.hidden);
      },
      { timeout: OPEN_LIMIT_S * 1000, polling: 250 },
    );
    row.ok = await page.evaluate(() => !document.getElementById('error').hidden ? false : true);
    if (!row.ok) {
      row.errTitle = await page.evaluate(
        () => document.getElementById('errTitle')?.textContent ?? '',
      );
    }
    await page.evaluate(() => window.__stopMem());
    const snap = await engineSnapshot(page);
    Object.assign(row, {
      total: snap.counts.total,
      drawn: snap.counts.drawn,
      undrawn: snap.counts.undrawn,
      converted: snap.counts.converted,
      byType: snap.counts.byType,
      msIdle: snap.msIdle,
      missedEmpty: snap.missed.empty,
      missedFonts: snap.missed.fonts.length,
      missedImages: snap.missed.images.length,
      missedXrefs: snap.missed.xrefs.length,
      layouts: snap.layouts.length,
      hasCanvas: snap.hasCanvas,
      canvasW: snap.w,
      canvasH: snap.h,
    });
    row.ms_open = await page.evaluate(() => Math.round(performance.now() - window.__openStart));
    row.ms_total = Date.now() - t0;
  } catch (e) {
    row.ok = row.ok ?? false;
    row.timeout = true;
    row.err = String(e).slice(0, 200);
    try {
      const m = await page.evaluate(() => window.__stopMem());
      row.heapPeakMB = Math.round(m.peak / 1048576);
    } catch {}
  }
  const mem = await page
    .evaluate(() => window.__stopMem?.() ?? { peak: 0, last: 0 })
    .catch(() => ({ peak: 0, last: 0 }));
  row.heapPeakMB = row.heapPeakMB ?? Math.round(mem.peak / 1048576);
  row.csp = cspViolations(capture).length;
  const ext = externalRequests(capture);
  row.extRequests = ext.length;
  if (ext.length) row.extList = [...new Set(ext)].slice(0, 5);
  row.consoleErrors = capture.console.filter((c) => c.type === 'error' || c.type === 'pageerror').length;
  if (row.csp || !row.ok) {
    row.consoleFirst = capture.console.slice(0, 8).map((c) => `[${c.type}] ${c.text}`);
    row.failedReq = capture.requests.filter((r) => r.startsWith('FAILED')).slice(0, 5);
  }
  const shot = path.join(shots, `${safeName(f.name)}_${tag || 'run'}.png`);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  row.shot = path.relative(process.cwd(), shot);
  await page.close().catch(() => {});
  rows.push(row);
  console.log('ROW ' + JSON.stringify(row));
}

await browser.close();
finish(rows, `open-corpus${tag ? '-' + tag : ''}.json`, {
  manifest: path.relative(process.cwd(), manifestPath),
  files: files.length,
});
