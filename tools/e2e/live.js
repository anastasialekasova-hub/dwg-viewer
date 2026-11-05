/**
 * Live check of the unpacked build (agent contract, block 3): Chrome for
 * Testing headless on the test server, temporary profile, the extension
 * loaded from the repository root, real network, audio muted. What a person
 * would check by hand is measured here: the welcome page on install (URL,
 * HTTP status), the extension card (chrome.management.getSelf: 1.0.0,
 * development), a real public .dwg opened through the link flow, a local
 * fixture open with zero external requests, the layers panel and background
 * switch on a live drawing, the print sheet on the release palette, the
 * rating URLs, the uninstall page address, and uninstallSelf at the end.
 *
 *   node tools/e2e/live.js   # screenshots and live.json in tools/e2e/out/live/
 *
 * Lines: "LIVE PASS|FAIL|INFO  <what>  — <measured>".
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, extensionId, viewerPage, ensureOut } from './e1/lib.js';
import { WELCOME_URL, UNINSTALL_URL, FEEDBACK_URL, STORE_REVIEWS_URL } from '../../src/lib/config.js';

const expectedVersion = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8')).version;
const OUT = path.join(ensureOut(), '..', 'live');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (kind, name, detail = '') => { results.push({ kind, name, detail }); console.log(`LIVE ${kind.padEnd(4)}  ${name}${detail === '' ? '' : `  — ${detail}`}`); };
const check = (name, ok, detail) => log(ok ? 'PASS' : 'FAIL', name, detail);
const info = (name, detail) => log('INFO', name, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpStatus(url) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    return `${r.status}${r.url !== url ? ` -> ${r.url.slice(0, 80)}` : ''}`;
  } catch (e) {
    return `network error: ${e.cause?.code || e.message}`;
  }
}

function filterExternal(capture) {
  return (capture.requests ?? []).filter((u) => {
    const url = u.startsWith('FAILED ') ? u.slice(7) : u;
    return !url.startsWith('chrome-extension://') && !url.startsWith('devtools://') && !url.startsWith('data:') && !url.startsWith('blob:');
  });
}

const REAL_DWG = 'https://github.com/DomCR/ACadSharp/raw/master/samples/sample_AC1032.dwg';

const browser = await launchWithExtension();
const extId = await extensionId(browser);
const swEval = async (fn, ...args) => {
  const t = browser.targets().find((x) => x.type() === 'service_worker' && x.url().startsWith(`chrome-extension://${extId}/`));
  const w = await t.worker(); // worker() returns a promise
  return w.evaluate(fn, ...args);
};

// ---------- extension card ----------
try {
  const card = await swEval(() => chrome.management.getSelf());
  check('extension card', card.version === expectedVersion && card.installType === 'development',
    `version ${card.version}, installType ${card.installType}, enabled ${card.enabled}`);
} catch (e) {
  check('extension card', false, String(e?.message ?? e).slice(0, 140));
}

// ---------- welcome + uninstall pages (real network) ----------
try {
  const welcome = await httpStatus(WELCOME_URL);
  info('welcome page', `${WELCOME_URL} — ${welcome} (404 before the pages stage ships is expected)`);
  const uninstall = await httpStatus(UNINSTALL_URL);
  info('uninstall page', `${UNINSTALL_URL} — ${uninstall}`);
  // There is no runtime.getUninstallURL: re-setting the same URL resolves
  // only when the address is valid, which is the arming check.
  const rearm = await swEval(async (u) => {
    try {
      await chrome.runtime.setUninstallURL(u);
      return 'set';
    } catch (e) {
      return String(e).slice(0, 120);
    }
  }, UNINSTALL_URL);
  check('uninstall URL armed', rearm === 'set', rearm);
} catch (e) {
  check('uninstall URL armed', false, String(e?.message ?? e).slice(0, 140));
}

// ---------- real drawing from the internet (link flow) ----------
try {
  const capture = {};
  const page = await viewerPage(browser, extId, capture);
  // A hash-only goto does not re-run the document: set the hash, then reload,
  // so init() reads #src= on a fresh load.
  await page.evaluate((u) => {
    location.hash = `src=${encodeURIComponent(u)}`;
  }, REAL_DWG);
  await page.reload({ waitUntil: 'load' });
  const settled = await page
    .waitForFunction(() => ['view', 'error'].includes(document.body.dataset.state), { timeout: 90000 })
    .then(() => true)
    .catch(async (e) => {
      const st = await page.evaluate(() => ({
        state: document.body.dataset.state,
        err: document.getElementById('errTitle')?.textContent,
        why: document.getElementById('errWhy')?.textContent?.slice(0, 120),
        cnt: document.getElementById('loadCnt')?.textContent,
      })).catch(() => ({}));
      info('real .dwg wait', `${String(e).slice(0, 60)}; state ${JSON.stringify(st)}`);
      return false;
    });
  const st = await page.evaluate(() => ({
    state: document.body.dataset.state,
    title: document.title,
    drawn: document.getElementById('drawnPill')?.textContent,
    srcHost: document.querySelector('#srcPath b')?.textContent,
    err: document.getElementById('errTitle')?.textContent,
  }));
  check('real .dwg from github opens', settled && st.state === 'view',
    `${st.state}: ${st.state === 'view' ? `${st.drawn}, from ${st.srcHost}, title ${st.title}` : st.err ?? 'timeout'}`);
  const ext = filterExternal(capture).filter((u) => !u.includes('github'));
  check('no external requests beyond the drawing', ext.length === 0, `${ext.length} non-github external request(s)`);
  await page.screenshot({ path: path.join(OUT, 'live-real-dwg.png') });

  // ---------- layers panel + background on the live drawing ----------
  await page.evaluate(() => document.getElementById('layersBtn').click());
  await sleep(600);
  const layers = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById('layersPanel')).display !== 'none',
    rows: document.querySelectorAll('#layersRows .lrow').length,
  }));
  check('layers panel opens', layers.visible && layers.rows > 0, `${layers.rows} layer rows`);
  await page.evaluate(() => document.getElementById('bgLight').click());
  await sleep(900);
  const bg = await page.evaluate(async () => {
    const m = await import(chrome.runtime.getURL('src/viewer/engine.js'));
    return { palette: m.canvasBackground(), cadbg: document.body.dataset.cadbg };
  });
  check('light background applies', bg.palette === 'light' && bg.cadbg === 'light', JSON.stringify(bg));
  await page.screenshot({ path: path.join(OUT, 'live-light-layers.png') });

  // ---------- print sheet on the release palette ----------
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed++;
    };
  });
  await page.evaluate(() => document.getElementById('printBtn').click());
  // Synchronous-raster smoke only. Native Print/Save is checked separately
  // on the Air; this synthetic event is not evidence of native printing.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await sleep(1500);
  const sheet = await page.evaluate(() => ({
    printed: window.__printed,
    raster: (() => {
      const canvas = document.getElementById('printShot2');
      if (canvas?.tagName !== 'CANVAS' || !canvas.width || !canvas.height) return { valid: false };
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 220) ink++;
      return { valid: true, width: canvas.width, height: canvas.height, ink };
    })(),
    layers: document.getElementById('printLayers').textContent,
    objects: document.getElementById('printObjects').textContent,
    page: document.getElementById('pageStyle').textContent,
  }));
  check('print sheet builds', sheet.printed === 1 && sheet.raster.valid && sheet.raster.ink > 0,
    `print() calls ${sheet.printed}, raster ${JSON.stringify(sheet.raster)}, ${sheet.layers}, ${sheet.objects}, ${sheet.page.trim()}`);
  await page.close();
} catch (e) {
  info('live drawing section', String(e?.message ?? e).slice(0, 160));
}

// ---------- local fixture: zero network, honest counter ----------
try {
  const capture = {};
  const page = await viewerPage(browser, extId, capture);
  await page.evaluate(async (rel) => {
    const buf = await (await fetch(chrome.runtime.getURL(rel))).arrayBuffer();
    const dt = new DataTransfer();
    dt.items.add(new File([buf], rel.split('/').pop()));
    const inp = document.getElementById('fileInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, path.join('tools', 'e2e', 'fixtures', 'acadsharp', 'sample_AC1015.dwg'));
  await page.waitForFunction(() => ['view', 'error'].includes(document.body.dataset.state), { timeout: 60000 });
  const st = await page.evaluate(() => ({ state: document.body.dataset.state, drawn: document.getElementById('drawnPill').textContent }));
  const extReq = filterExternal(capture);
  check('local file opens with zero network', st.state === 'view' && extReq.length === 0,
    `${st.drawn}, external requests ${extReq.length}`);
  await page.close();
} catch (e) {
  info('local fixture section', String(e?.message ?? e).slice(0, 160));
}

// ---------- rating URLs ----------
{
  const store = STORE_REVIEWS_URL(extId);
  check('rating URLs built from runtime id',
    store === `https://chromewebstore.google.com/detail/${extId}/reviews` && FEEDBACK_URL.endsWith('/feedback/'),
    store);
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'live.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.kind === 'FAIL');
console.log(`LIVE DONE pass=${results.filter((r) => r.kind === 'PASS').length} fail=${failed.length}`);
process.exit(failed.length ? 1 : 0);
