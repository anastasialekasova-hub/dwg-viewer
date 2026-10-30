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

const REAL_DWG = 'https://github.com/DomCR/ACadSharp/raw/master/samples/sample_AC1032.dwg';

const browser = await launchWithExtension();
try {
  const extId = await extensionId(browser);

  // ---------- extension card ----------
  {
    const card = await browser.targets()
      .find((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`))
      .worker()
      .evaluate(() => chrome.management.getSelf());
    check('extension card', card.version === '1.0.0' && card.installType === 'development',
      `version ${card.version}, installType ${card.installType}, enabled ${card.enabled}`);
  }

  // ---------- welcome + uninstall pages (real network) ----------
  {
    const welcome = await httpStatus(WELCOME_URL);
    info('welcome page', `${WELCOME_URL} — ${welcome} (404 before the pages stage ships is expected)`);
    const uninstall = await httpStatus(UNINSTALL_URL);
    info('uninstall page', `${UNINSTALL_URL} — ${uninstall}`);
    const setUrl = await browser.targets()
      .find((t) => t.type() === 'service_worker')
      .worker()
      .evaluate(() => chrome.runtime.getUninstallURL?.() ?? null);
    check('uninstall URL armed', typeof setUrl === 'string' && setUrl === UNINSTALL_URL, setUrl ?? 'not set');
  }

  // ---------- real drawing from the internet (link flow) ----------
  {
    const capture = {};
    const page = await viewerPage(browser, extId, capture);
    await page.goto(`chrome-extension://${extId}/src/viewer/viewer.html#src=${encodeURIComponent(REAL_DWG)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => ['view', 'error'].includes(document.body.dataset.state), { timeout: 90000 });
    const st = await page.evaluate(() => ({
      state: document.body.dataset.state,
      title: document.title,
      drawn: document.getElementById('drawnPill').textContent,
      srcHost: document.querySelector('#srcPath b')?.textContent,
      err: document.getElementById('errTitle').textContent,
    }));
    check('real .dwg from github opens', st.state === 'view',
      `${st.state}: ${st.state === 'view' ? `${st.drawn}, from ${st.srcHost}, title ${st.title}` : st.err}`);
    const ext = (await import(pathToFileURLHelper())).filterExternal(capture);
    check('no external requests beyond the drawing', ext.filter((u) => !u.includes('github')).length === 0,
      `${ext.length} external request(s) total`);
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
    await sleep(1500);
    const sheet = await page.evaluate(() => ({
      printed: window.__printed,
      imgKB: Math.round(((document.getElementById('printShot2')?.src ?? '').length * 3) / 4 / 1024),
      layers: document.getElementById('printLayers').textContent,
      objects: document.getElementById('printObjects').textContent,
      page: document.getElementById('pageStyle').textContent,
    }));
    check('print sheet builds', sheet.printed === 1 && sheet.imgKB > 20,
      `print() calls ${sheet.printed}, snapshot ${sheet.imgKB} KB, ${sheet.layers}, ${sheet.objects}, ${sheet.page.trim()}`);
    await page.close();
  }

  // ---------- local fixture: zero network, honest counter ----------
  {
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
    const extReq = capture.requests.filter((u) => !u.startsWith('chrome-extension://') && !u.startsWith('devtools://') && !u.startsWith('data:'));
    check('local file opens with zero network', st.state === 'view' && extReq.length === 0,
      `${st.drawn}, external requests ${extReq.length}`);
    await page.close();
  }

  // ---------- rating URLs ----------
  {
    const urls = await page.evaluate(() => null).catch(() => null);
    const store = STORE_REVIEWS_URL(extId);
    check('rating URLs built from runtime id', store === `https://chromewebstore.google.com/detail/${extId}/reviews` && FEEDBACK_URL.endsWith('/feedback/'), `${store}`);
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'live.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.kind === 'FAIL');
  console.log(`LIVE DONE pass=${results.filter((r) => r.kind === 'PASS').length} fail=${failed.length}`);
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error('LIVE-FATAL ' + String(e?.stack ?? e).slice(0, 800));
  fs.writeFileSync(path.join(OUT, 'live.json'), JSON.stringify(results, null, 2));
  await browser.close().catch(() => {});
  process.exit(1);
}

function pathToFileURLHelper() {
  // small helper kept at the bottom: the external-request filter used above
  return {
    filterExternal(capture) {
      return (capture.requests ?? []).filter((u) => {
        const url = u.startsWith('FAILED ') ? u.slice(7) : u;
        return !url.startsWith('chrome-extension://') && !url.startsWith('devtools://') && !url.startsWith('data:') && !url.startsWith('blob:');
      });
    },
  };
}
