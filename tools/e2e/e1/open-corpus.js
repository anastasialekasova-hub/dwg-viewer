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
  pixelMetric,
  screenWord,
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
        const end = (ok && !ok.hidden) || (err && !err.hidden);
        if (end && !window.__openEnd) window.__openEnd = performance.now();
        return end;
      },
      // Past the viewer's own deadline, so its timeout card is observed too.
      { timeout: (OPEN_LIMIT_S + 20) * 1000, polling: 100 },
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
      parseInfo: snap.counts.parseInfo,
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
    row.ms_open = await page.evaluate(() => Math.round(window.__openEnd - window.__openStart));
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
  // The engine keeps working after the pill (its progress overlay is hidden by
  // viewer.css, but its inline display still says "busy"): measure the screen
  // only once it is idle, and record how long that took.
  if (row.ok) {
    const w0 = Date.now();
    row.engineBusyAfterPill = await page
      .waitForFunction(
        () => ![...document.querySelectorAll('.ml-ccl-overlay')].some((e) => e.style.display === 'flex'),
        { timeout: 30000, polling: 100 },
      )
      .then(() => Date.now() - w0)
      .catch(() => 'timeout 30 s');
    await new Promise((r) => setTimeout(r, 300));
  }
  const shot = path.join(shots, `${safeName(f.name)}_${tag || 'run'}.png`);
  const png = await page.screenshot({ path: shot, fullPage: false }).catch(() => null);
  row.shot = path.relative(process.cwd(), shot);
  if (png) {
    row.px = await pixelMetric(browser, png).catch((e) => ({ err: String(e).slice(0, 120) }));
    row.screen = row.ok ? screenWord(row.px) : 'карточка';
  }
  // Fit button and double-click must give the same frame as the open (F-8).
  if (row.ok) {
    let stage = 'ping';
    const tf = Date.now();
    try {
      await page.evaluate(() => 1);
      row.pingMs = Date.now() - tf;
      stage = 'fit-click';
      await page.click('#fitBtn');
      stage = 'fit-shot';
      await new Promise((r) => setTimeout(r, 800));
      const pf = await page.screenshot({ fullPage: false });
      stage = 'fit-metric';
      row.pxFit = await pixelMetric(browser, pf);
      stage = 'dbl';
      const box = await (await page.$('#cad canvas')).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { count: 2 });
      await new Promise((r) => setTimeout(r, 800));
      const pd = await page.screenshot({
        path: shot.replace(/\.png$/, '_dbl.png'),
        fullPage: false,
      });
      row.pxDbl = await pixelMetric(browser, pd);
    } catch (e) {
      row.fitErr = `${stage} after ${Date.now() - tf} ms: ${String(e).slice(0, 140)}`;
    }
  }
  await page.close().catch(() => {});
  rows.push(row);
  console.log('ROW ' + JSON.stringify(row));
}

await browser.close();
finish(rows, `open-corpus${tag ? '-' + tag : ''}.json`, {
  manifest: path.relative(process.cwd(), manifestPath),
  files: files.length,
});
