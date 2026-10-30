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
// page.click() intermittently hangs on this Windows CfT setup (Runtime
// .callFunctionOn never answers — same flake that hit the E1 fit click);
// synthetic clicks are enough for everything this script drives.
// No retry: a hung first attempt can still deliver its click late, and a
// retry would fire twice — fatal for toggle buttons like Layers (the panel
// probe proved the toggle itself works; the run had clicked it twice).
const eclick = async (page, sel) =>
  Promise.race([
    page.evaluate((x) => document.querySelector(x)?.click(), sel),
    sleep(15000).then(() => Promise.reject(new Error(`eclick ${sel} hang`))),
  ]);
const shot = async (page, file) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await Promise.race([
        page.screenshot({ path: path.join(OUTDIR, file) }),
        sleep(30000).then(() => Promise.reject(new Error(`shot ${file} hang`))),
      ]);
    } catch (e) {
      if (attempt === 1) throw e;
      await sleep(1500);
    }
  }
};
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
  try {
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
      await shot(page, 'main-dark-layers.png');
      const m = await pixelMetric(browser, await page.screenshot());
      out.mainDark = { ui, ink: m.sharePct, bg: m.bg };

      // zoom indicator moves after two zoom-ins
      await eclick(page, '#zoomInBtn');
      await eclick(page, '#zoomInBtn');
      await sleep(400);
      out.mainDark.zoomAfterIn = await page.evaluate(() => document.getElementById('zoomPct').textContent);
      await eclick(page, '#fitBtn');
      await sleep(600);
      out.mainDark.zoomAfterFit = await page.evaluate(() => document.getElementById('zoomPct').textContent);

      // ---------- light background ----------
      await eclick(page, '#bgLight');
      await sleep(1200);
      const light = await page.evaluate(async () => {
        const m = await import(chrome.runtime.getURL('src/viewer/engine.js'));
        return { palette: m.canvasBackground(), cadbg: document.body.dataset.cadbg };
      });
      await shot(page, 'main-light.png');
      const ml = await pixelMetric(browser, await page.screenshot());
      out.mainLight = { ui: light, ink: ml.sharePct, bg: ml.bg };
      // light survives a reload (settings.background)
      await page.reload({ waitUntil: 'load' });
      await sleep(1500);
      out.mainLight.reload = await page.evaluate(() => document.body.dataset.cadbg);
      await eclick(page, '#bgDark').catch(() => {});
      await page.close();
    }
  } catch (e) {
    out['section_0'] = { err: String(e?.message ?? e).slice(0, 140) };
  }

  // ---------- settings popover + hint + coords ----------
  try {
    // ---------- settings popover + hint + coords ----------
    {
      const page = await openFile(FILES.main);
      await waitView(page);
      await sleep(1000);
      await eclick(page, '#settingsBtn');
      await sleep(400);
      out.settings = await page.evaluate(() => ({
        popOpen: !document.getElementById('settingsPop').hidden,
        toggle: document.getElementById('settingsToggle').getAttribute('aria-checked'),
        lbl: document.getElementById('settingsToggleLbl').textContent,
      }));
      await shot(page, 'settings-pop.png');
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
      await shot(page, 'settings-off.png');
      out.settings.toggleAfter = ruleOff;
      await page.evaluate(async () => {
        await chrome.storage.local.set({ interceptLinks: true, hintSeen: false });
      });
      await page.close();
    }
  } catch (e) {
    out['section_1'] = { err: String(e?.message ?? e).slice(0, 140) };
  }

  // ---------- empty-drawing cards ----------
  try {
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
      await shot(page, `empty-${name}.png`);
      await page.close();
    }
  } catch (e) {
    out['section_2'] = { err: String(e?.message ?? e).slice(0, 140) };
  }

  // ---------- example_r14 fitted on open ----------
  try {
    // ---------- example_r14 fitted on open ----------
    {
      const page = await openFile(FILES.r14);
      await waitView(page);
      await sleep(1500);
      const m = await pixelMetric(browser, await page.screenshot());
      out.r14 = { ink: m.sharePct, bboxW: m.bboxW, bboxH: m.bboxH, word: m.sharePct >= 0.05 && (m.bboxW >= 30 || m.bboxH >= 30) ? 'чертёж' : 'частично' };
      await shot(page, 'r14-open.png');
      await page.close();
    }
  } catch (e) {
    out['section_3'] = { err: String(e?.message ?? e).slice(0, 140) };
  }

  // ---------- Fit click: harness vs product, five fresh pages ----------
  try {
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
              await eclick(page, '#fitBtn', { timeout: 20000 });
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
  } catch (e) {
    out['section_4'] = { err: String(e?.message ?? e).slice(0, 140) };
  }

  // ---------- widget hidden while the drawing is incomplete ----------
  try {
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
  } catch (e) {
    out['section_5'] = { err: String(e?.message ?? e).slice(0, 140) };
  }

  await browser.close();
  finish([out], 'screens.json');
  process.exit(0);
} catch (err) {
  console.error('SCREENS-FATAL ' + String(err?.stack ?? err).slice(0, 1200));
  await browser.close().catch(() => {});
  process.exit(1);
}
