// Interaction checks (ТЗ 4.2.7, 4.2.11–4.2.14) against the real extension:
//   4.2.7  layout tabs: two tabs, click switches active layout
//   4.2.11 Ctrl+O opens the file chooser (filechooser event)
//   4.2.13 print: page.pdf() succeeds, tab title set; @page/print CSS = gap
//   4.2.14 incognito: manifest key + note that the grant is user-only
//   4.2.12 Alt+Shift+D: manifest command + action.onClicked handler exists
//   CHROME_PATH=... node tools/e2e/e1/interactions.js <dwg-with-2+-layouts>
import fs from 'node:fs';
import path from 'node:path';
import {
  launchWithExtension,
  extensionId,
  viewerPage,
  armPage,
  engineSnapshot,
  finish,
  ensureOut,
  safeName,
} from './lib.js';

const fileArg = path.resolve(process.argv[2]);
const browser = await launchWithExtension();
const extId = await extensionId(browser);
const capture = {};
const page = await viewerPage(browser, extId, capture);
await armPage(page);
const rows = [];
const shotDir = ensureOut('screens');
const abs = path.join(process.cwd(), path.relative(process.cwd(), fileArg));

// --- open a drawing via file input (no link flow here) ---
const chooser0 = await page.waitForSelector('#fileInput', { timeout: 10000 });
await chooser0.uploadFile(abs);
await page.waitForFunction(
  () => {
    const ok = document.getElementById('drawnPill');
    return ok && !ok.hidden;
  },
  { timeout: 90000, polling: 300 },
);

// --- 4.2.7 layout tabs ---
{
  const row = { check: '4.2.7-layout-tabs' };
  const snap = await engineSnapshot(page);
  row.layouts = snap.layouts.map((l) => l.name);
  const tabs = await page.evaluate(() => {
    const wrap = document.getElementById('layoutTabs');
    const tabs = [...wrap.querySelectorAll('.stab')];
    return {
      wrapHidden: wrap.hidden,
      n: tabs.length,
      states: tabs.map((t) => ({ label: t.textContent, selected: t.getAttribute('aria-selected') })),
    };
  });
  row.tabsHidden = tabs.wrapHidden;
  row.tabCount = tabs.n;
  row.before = tabs.states;
  if (tabs.n >= 2) {
    const beforeId = await page.evaluate(async () => {
      const m = await import(chrome.runtime.getURL('src/viewer/engine.js'));
      return m.activeLayoutBtrId();
    });
    await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#layoutTabs .stab')];
      tabs.find((t) => t.getAttribute('aria-selected') !== 'true').click();
    });
    await new Promise((r) => setTimeout(r, 1200));
    row.after = await page.evaluate(() =>
      [...document.querySelectorAll('#layoutTabs .stab')].map((t) => ({
        label: t.textContent,
        selected: t.getAttribute('aria-selected'),
      })),
    );
    const afterId = await page.evaluate(async () => {
      const m = await import(chrome.runtime.getURL('src/viewer/engine.js'));
      return m.activeLayoutBtrId();
    });
    row.btrSwitch = beforeId !== afterId;
    row.selSwitch =
      row.before.filter((s) => s.selected === 'true').map((s) => s.label).join() !==
      row.after.filter((s) => s.selected === 'true').map((s) => s.label).join();
    const snap2 = await engineSnapshot(page);
    row.canvasStill = snap2.hasCanvas;
    row.ok = row.btrSwitch && row.selSwitch && row.canvasStill;
  } else {
    row.ok = false;
    row.skip = 'need ≥2 layouts';
  }
  rows.push(row);
  console.log('ROW ' + JSON.stringify(row));
}

// --- 4.2.11 Ctrl+O ---
{
  const row = { check: '4.2.11-ctrl-o' };
  const fc = page.waitForFileChooser({ timeout: 10000 });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyO');
  await page.keyboard.up('Control');
  try {
    await fc;
    row.fileChooser = true;
  } catch {
    row.fileChooser = false;
  }
  row.cancelledNative = true; // chooser is puppeteer-intercepted, nothing opens
  row.ok = row.fileChooser;
  rows.push(row);
  console.log('ROW ' + JSON.stringify(row));
}

// --- 4.2.13 print ---
{
  const row = { check: '4.2.13-print' };
  row.title = await page.title();
  row.titleHasName = /sample_2018/i.test(row.title);
  const pdfPath = path.join(shotDir, `print_${safeName(path.basename(fileArg))}.pdf`);
  try {
    await page.pdf({ path: pdfPath, printBackground: true });
    const buf = fs.readFileSync(pdfPath);
    row.pdfBytes = buf.length;
    row.pdfMagic = buf.slice(0, 5).toString('latin1') === '%PDF-';
    const canvas = await page.evaluate(() => {
      const c = document.querySelector('#cad canvas');
      return c ? { w: c.width, h: c.height } : null;
    });
    row.canvas = canvas;
    row.ok = row.pdfMagic && row.pdfBytes > 10000;
  } catch (e) {
    row.pdfErr = String(e).slice(0, 150);
    row.ok = false;
  }
  row.cssPageRule = /@page/.test(fs.readFileSync('src/viewer/viewer.css', 'utf8'));
  row.cssPrintMedia = /@media\s+print/.test(fs.readFileSync('src/viewer/viewer.css', 'utf8'));
  row.note = 'canvas content in PDF not asserted (canvas raster depends on printBackground + GPU); @page/print rules: none in viewer.css — GAP vs ТЗ, see report';
  rows.push(row);
  console.log('ROW ' + JSON.stringify(row));
}

// --- 4.2.14 incognito ---
{
  const row = { check: '4.2.14-incognito' };
  const man = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  row.manifestIncognitoKey = man.incognito ?? '(absent → default "spanning")';
  row.note =
    'The "Allow in incognito" grant is a chrome://extensions user toggle — cannot be automated from CDP; extension pages do not run in an incognito context without it. Manual step for Ана: chrome://extensions → DWG Viewer → Details → Allow in incognito.';
  row.ok = null;
  rows.push(row);
  console.log('ROW ' + JSON.stringify(row));
}

// --- 4.2.12 Alt+Shift+D ---
{
  const row = { check: '4.2.12-alt-shift-d' };
  const man = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  row.command = man.commands?._execute_action?.suggested_key?.default ?? null;
  const sw = fs.readFileSync('src/background/service-worker.js', 'utf8');
  row.actionOnClickedaHandler = /chrome\.action\.onClicked\.addListener/.test(sw);
  row.note =
    'Browser-level command shortcuts cannot be dispatched from CDP (Input events go to the page, not the browser). Verified statically: manifest command + onClicked handler. Manual: chrome://extensions/shortcuts shows Alt+Shift+D.';
  row.ok = Boolean(row.command) && row.actionOnClickedaHandler;
  rows.push(row);
  console.log('ROW ' + JSON.stringify(row));
}

await browser.close();
finish(rows, 'interactions.json', { file: path.basename(fileArg) });
process.exit(0);
