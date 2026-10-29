// Diagnostic: drive engine.open directly in the viewer page (bypassing the
// viewer's 60s race + showError/dispose) and poll engine state every 2s for
// up to DIAG_S, to tell "slow but progressing" from "stuck forever".
//   node tools/e2e/e1/diag-open.js <file> [diagSeconds]
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
} from './lib.js';

const fileArg = path.resolve(process.argv[2]);
const diagS = Number(process.argv[3] ?? 180);
const b64 = fs.readFileSync(fileArg).toString('base64');
const name = path.basename(fileArg);

const browser = await launchWithExtension();
let exitCode = 0;
try {
const extId = await extensionId(browser);
const capture = {};
const page = await viewerPage(browser, extId, capture);
await armPage(page);
if (process.env.DIAG_FRONT === '1') await page.bringToFront();
if (process.env.DIAG_HIDE === '1') await (await browser.newPage()).bringToFront(); // viewer becomes a background tab
page.on('workercreated', (w) => {
  console.log('WORKER+ ' + w.url().split('/').pop());
  w.on('console', (m) => console.log('WCONSOLE ' + m.type() + ' ' + m.text().slice(0, 300)));
});
page.on('workerdestroyed', (w) => console.log('WORKER- ' + w.url().split('/').pop()));

await page.evaluate(async (b64name) => {
  const bytes = Uint8Array.from(atob(b64name.b64), (c) => c.charCodeAt(0));
  const url = chrome.runtime.getURL('src/viewer/engine.js');
  const m = await import(url);
  const cv = await import(chrome.runtime.getURL('src/vendor/cad-viewer.js'));
  window.__diag = { progressEvents: 0, lastProgress: null, openResult: null, openErr: null, t0: performance.now(), ensureErr: null };
  try {
    m.ensureEngine(document.getElementById('cad'));
  } catch (e) {
    window.__diag.ensureErr = String(e).slice(0, 300);
  }
  cv.eventBus.on('open-file-progress', (a) => {
    window.__diag.progressEvents++;
    try {
      window.__diag.lastProgress = [a?.stage, a?.subStage, a?.subStageStatus, a?.percentage].join('|');
      (window.__diag.stages ??= []).push(window.__diag.lastProgress + '@' + Math.round(performance.now() - window.__diag.t0));
    } catch {
      window.__diag.lastProgress = String(a).slice(0, 160);
    }
  });
  window.__open = m
    .open({ name: b64name.name, bytes, onProgress: () => {} })
    .then((r) => (window.__diag.openResult = r))
    .catch((e) => (window.__diag.openErr = String(e).slice(0, 300)));
}, { b64, name });

const ticks = [];
for (let t = 2; t <= diagS; t += 2) {
  await new Promise((r) => setTimeout(r, 2000));
  const tick = await page
    .evaluate(async () => {
      const url = chrome.runtime.getURL('src/viewer/engine.js');
      const m = await import(url);
      let counts = null, processing = null, cerr = null;
      try {
        counts = m.counts();
        processing = m.isProcessing();
      } catch (e) {
        cerr = String(e).slice(0, 120);
      }
      const d = window.__diag ?? {};
      const raf = await new Promise((ok) => {
        let done = false;
        requestAnimationFrame(() => { if (!done) { done = true; ok('fired'); } });
        setTimeout(() => { if (!done) { done = true; ok('timeout1s'); } }, 1000);
      });
      return {
        vis: document.visibilityState, focus: document.hasFocus(), raf,
        t: Math.round(performance.now() - (d.t0 ?? 0)),
        counts,
        processing,
        cerr,
        openResult: d.openResult ?? null,
        openErr: d.openErr ?? null, ensureErr: d.ensureErr ?? null,
        progressEvents: d.progressEvents ?? 0,
        lastProgress: d.lastProgress ?? null, stages: (d.stages ?? []).slice(-6),
      };
    })
    .catch((e) => ({ t, evalError: String(e).slice(0, 120) }));
  ticks.push(tick);
  console.log('TICK ' + JSON.stringify(tick));
  if (tick.openResult?.ok && tick.counts && !tick.processing) {
    const done = await page.evaluate(() => window.__stopMem?.() ?? { peak: 0, last: 0 });
    console.log('DIAG-DONE ' + JSON.stringify(done));
    break;
  }
}

const row = { file: name, sizeKB: Math.round(fs.statSync(fileArg).size / 1024) };
const snap = await engineSnapshot(page).catch((e) => ({ snapError: String(e).slice(0, 200) }));
Object.assign(row, { snap });
row.pageErrors = capture.console.filter((c) => c.type === 'pageerror').map((c) => (c.stack ?? c.text).slice(0, 500));
row.consoleErrs = capture.console.filter((c) => c.type === 'error').map((c) => c.text.slice(0, 200));
row.extList = externalRequests(capture).slice(0, 10);
row.failedReq = capture.requests.filter((r) => r.startsWith('FAILED')).slice(0, 8);
row.csp = cspViolations(capture).length;
row.ticks = ticks.length;
const shotDir = ensureOut('screens');
const shot = path.join(shotDir, `diag_${safeName(name)}.png`);
await page.screenshot({ path: shot }).catch(() => {});
row.shot = path.relative(process.cwd(), shot);
await browser.close();
finish([row], `diag-open-${safeName(name)}.json`, {});
process.exit(exitCode);
} catch (err) {
  console.error('DIAG-FATAL ' + String(err?.stack ?? err).slice(0, 600));
  await browser.close().catch(() => {});
  process.exit(1);
}
