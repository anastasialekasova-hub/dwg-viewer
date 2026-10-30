// Э2/Э3 screen checks: UI screenshots (Main with layers panel, light
// background, settings popover), empty-drawing cards, Fit-click harness-vs-
// product evidence, zoom indicator, example_r14 fit-on-open, widget-hidden-
// when-incomplete. Runs on the test server:
//   node tools/e2e/e2/screens.js
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, extensionId, viewerPage, ensureOut, pixelMetric, finish } from '../e1/lib.js';

const ROOT = process.cwd();
const F = (p) => path.join(ROOT, p);
const FILES = {
  main: F('tools/e2e/fixtures/acadsharp/sample_AC1015.dwg'),
  block: F('tools/e2e/fixtures-local/libredwg-testdata/r2.10/block.dxf'),
  poly: F('tools/e2e/fixtures-local/libredwg-testdata/2000/PolyLine2D.dxf'),
  condo: F('tools/e2e/fixtures-local/real/autodesk/visualization_-_condominium_with_skylight.dwg'),
  r14: F('tools/e2e/fixtures-local/libredwg-testdata/example_r14.dwg'),
};
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchWithExtension();
const OUTDIR = ensureOut('screens');
try {
  const extId = await extensionId(browser);

  const openFile = async (p) => {
    const capture = {};
    const page = await viewerPage(browser, extId, capture);
    await page.evaluate(async (rel) => {
      const buf = await (await fetch(chrome.runtime.getURL(rel))).arrayBuffer();
      const dt = new DataTransfer();
      dt.items.add(new File([buf], rel.split('/').pop()));
      const inp = document.getElementById('fileInput');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, path.relative(ROOT, p));
    return page;
  };
  const waitView = (page, ms = 60000) =>
    page.waitForFunction(() => ['view', 'error'].includes(document.body.dataset.state), { timeout: ms });

  // ---------- Main screen with the layers panel, dark ----------
  {
    const page = await openFile(FILES.main);
    await waitView(page);
    await sleep(1500);
    await page.evaluate(() => {
      document.getElementById('layersBtn').click();
      document.getElementById('layersBtn').click(); // panel on
    });
    await sleep(700);
    const ui = await page.evaluate(() => ({
      layerRows: document.querySelectorAll('#layersRows .lrow').length,
      layersCount: document.getElementById('layersCount').textContent,
      zoom: document.getElementById('zoomPct').textContent,
      layersPanelVisible: getComputedStyle(document.getElementById('layersPanel')).display !== 'none',
    }));
    await page.screenshot({ path: path.join(OUTDIR, 'main-dark-layers.png') });
    const m = await pixelMetric(browser, await page.screenshot());
    out.mainDark = { ui, ink: m.sharePct, bg: m.bg };

    // zoom indicator moves after two zoom-ins
    await page.click('#zoomInBtn');
    await page.click('#zoomInBtn');
    await sleep(400);
    out.mainDark.zoomAfterIn = await page.evaluate(() => document.getElementById('zoomPct').textContent);
    await page.click('#fitBtn');
    await sleep(600);
    out.mainDark.zoomAfterFit = await page.evaluate(() => document.getElementById('zoomPct').textContent);

    // ---------- light background ----------
    await page.click('#bgLight');
    await sleep(1200);
    const light = await page.evaluate(async () => {
      const m = await import(chrome.runtime.getURL('src/viewer/engine.js'));
      return { palette: m.canvasBackground(), cadbg: document.body.dataset.cadbg };
    });
    await page.screenshot({ path: path.join(OUTDIR, 'main-light.png') });
    const ml = await pixelMetric(browser, await page.screenshot());
    out.mainLight = { ui: light, ink: ml.sharePct, bg: ml.bg };
    // light survives a reload (settings.background)
    await page.reload({ waitUntil: 'load' });
    await sleep(1500);
    out.mainLight.reload = await page.evaluate(() => document.body.dataset.cadbg);
    await page.click('#bgDark').catch(() => {});
    await page.close();
  }

  // ---------- settings popover + hint + coords ----------
  {
    const page = await openFile(FILES.main);
    await waitView(page);
    await sleep(1000);
    await page.click('#settingsBtn');
    await sleep(400);
    out.settings = await page.evaluate(() => ({
      popOpen: !document.getElementById('settingsPop').hidden,
      toggle: document.getElementById('settingsToggle').getAttribute('aria-checked'),
      lbl: document.getElementById('settingsToggleLbl').textContent,
    }));
    await page.screenshot({ path: path.join(OUTDIR, 'settings-pop.png') });
    await page.mouse.move(500, 400);
    await sleep(300);
    out.coords = await page.evaluate(() => document.getElementById('coords').textContent);
    // toggle off → DNR rule removed (F-22 semantics)
    const ruleOff = await page.evaluate(async () => {
      document.getElementById('settingsToggle').click();
      await new Promise((r) => setTimeout(r, 800));
      // storage read from the page context
      const v = await chrome.storage.local.get('interceptLinks');
      return v.interceptLinks;
    });
    await page.screenshot({ path: path.join(OUTDIR, 'settings-off.png') });
    out.settings.toggleAfter = ruleOff;
    await page.evaluate(async () => {
      await chrome.storage.local.set({ interceptLinks: true, hintSeen: false });
    });
    await page.close();
  }

  // ---------- empty-drawing cards ----------
  for (const [name, file] of [['block', FILES.block], ['polyline2d', FILES.poly], ['condominium', FILES.condo]]) {
    const page = await openFile(file);
    await waitView(page);
    await sleep(1200);
    out[`empty_${name}`] = await page.evaluate(() => ({
      state: document.body.dataset.state,
      drawn: document.getElementById('drawnPill').textContent,
      emptyCard: !document.getElementById('emptycard').hidden,
      emptyText: document.getElementById('emptyTitle')?.textContent,
      partial: !document.getElementById('partial').hidden,
      partialMsg: document.getElementById('partialMsg')?.textContent.slice(0, 120),
    }));
    await page.screenshot({ path: path.join(OUTDIR, `empty-${name}.png`) });
    await page.close();
  }

  // ---------- example_r14 fitted on open ----------
  {
    const page = await openFile(FILES.r14);
    await waitView(page);
    await sleep(1500);
    const m = await pixelMetric(browser, await page.screenshot());
    out.r14 = { ink: m.sharePct, bboxW: m.bboxW, bboxH: m.bboxH, word: m.sharePct >= 0.05 && (m.bboxW >= 30 || m.bboxH >= 30) ? 'чертёж' : 'частично' };
    await page.screenshot({ path: path.join(OUTDIR, 'r14-open.png') });
    await page.close();
  }

  // ---------- Fit click: harness vs product, five fresh pages ----------
  {
    const rows = [];
    for (const [name, file] of [['ac1015', FILES.main], ['r14', FILES.r14], ['condo', FILES.condo]]) {
      for (const method of ['mouse', 'evaluate']) {
        const page = await openFile(file);
        await waitView(page);
        await sleep(1200);
        const t0 = Date.now();
        let err = null;
        try {
          if (method === 'mouse') {
            await page.click('#fitBtn', { timeout: 20000 });
          } else {
            await page.evaluate(() => document.getElementById('fitBtn').click());
          }
          await sleep(800);
        } catch (e) {
          err = String(e?.message ?? e).slice(0, 120);
        }
        rows.push({ file: name, method, ms: Date.now() - t0, err });
        await page.close();
      }
    }
    out.fitClick = rows;
  }

  // ---------- widget hidden while the drawing is incomplete ----------
  {
    const page = await openFile(FILES.condo);
    await waitView(page);
    await page.evaluate(async () => {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
      await chrome.storage.local.set({
        review: { version: 1, usefulDays: 5, lastUsefulDay: yesterday, answered: false, dismissals: 0, snoozeUntil: 0 },
        hintSeen: true,
      });
    });
    await sleep(62000);
    out.widgetIncomplete = await page.evaluate(() => ({
      gaps: document.getElementById('drawnPill').classList.contains('undrawn'),
      rateHidden: document.getElementById('rate').hidden,
    }));
    await page.close();
  }

  await browser.close();
  finish([out], 'screens.json');
  process.exit(0);
} catch (err) {
  console.error('SCREENS-FATAL ' + String(err?.stack ?? err).slice(0, 1200));
  await browser.close().catch(() => {});
  process.exit(1);
}
