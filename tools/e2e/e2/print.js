// Э2 print (ТЗ 10.2 case 9 + печатная часть 10.5): the sheet is built in
// beforeprint from engine.printView() (offscreen render); window.print is
// stubbed so the flow is deterministic. Runs on the test server:
//   node tools/e2e/e2/print.js <fixture.dwg>
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, extensionId, viewerPage } from '../e1/lib.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'tools', 'e2e', 'out', 'e2');
const fixture = path.resolve(process.argv[2] ?? path.join(ROOT, 'tools', 'e2e', 'fixtures', 'acadsharp', 'sample_AC1015.dwg'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchWithExtension();
const out = {};
try {
  const extId = await extensionId(browser);
  const capture = {};
  const page = await viewerPage(browser, extId, capture);
  await page.evaluateOnNewDocument(() => {
    window.__prints = [];
    window.print = () => {
      // document.title at the call moment is Chrome's default PDF name
      window.__prints.push({ title: document.title, at: performance.now() });
    };
  });
  await page.evaluate(async (rel) => {
    const buf = await (await fetch(chrome.runtime.getURL(rel))).arrayBuffer();
    const dt = new DataTransfer();
    dt.items.add(new File([buf], rel.split('/').pop()));
    const inp = document.getElementById('fileInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, path.relative(ROOT, fixture));
  await page.waitForFunction(() => document.body.dataset.state === 'view' || document.body.dataset.state === 'error', { timeout: 60000 });
  out.opened = await page.evaluate(() => ({
    state: document.body.dataset.state,
    title: document.title,
    drawn: document.getElementById('drawnPill').textContent,
  }));

  await page.evaluate(() => window.print());
  await sleep(1200);
  out.printCalls = await page.evaluate(() => window.__prints);

  out.sheet = await page.evaluate(() => ({
    name: document.getElementById('printName')?.textContent,
    layout: document.getElementById('printLayout')?.textContent,
    date: document.getElementById('printDate')?.textContent,
    layers: document.getElementById('printLayers')?.textContent,
    objects: document.getElementById('printObjects')?.textContent,
    imgKB: Math.round(((document.getElementById('printShot2')?.src ?? '').length * 3) / 4 / 1024),
    pageStyle: document.getElementById('pageStyle')?.textContent,
  }));
  out.engineUiOnSheet = await page.evaluate(() =>
    ['.ml-cli-container', '.ml-shortcut-toolbar', '[class*="ml-toolbar"]', '[class*="ribbon"]'].map(
      (s) => `${s}:${document.querySelectorAll(s).length}`,
    ),
  );
  out.gl = await page.evaluate(async () => {
    const m = await import(chrome.runtime.getURL('src/viewer/engine.js'));
    const url = m.printView();
    return { printViewKB: Math.round((url.length * 3) / 4 / 1024), maxRB: (() => {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl');
      return g ? g.getParameter(g.MAX_RENDERBUFFER_SIZE) : null;
    })() };
  });

  // print-media screenshot: only the sheet (top bar absent, ink present)
  await page.emulateMediaType('print');
  await page.screenshot({ path: path.join(OUT, 'print-media.png') });
  await page.screenshot({ path: path.join(OUT, 'print-screen.png') }).catch(() => {});
  // printToPDF on this build renders the SCREEN layout unless the print
  // emulation is active while the PDF is made (real Ctrl+P always uses the
  // print layout; this is harness-only). Keep print emulation during pdf().
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  await page.emulateMediaType('screen');
  fs.writeFileSync(path.join(OUT, 'print.pdf'), pdf);
  out.pdfBytes = pdf.length;
  out.pdfPages = (String(pdf).match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  console.log('PRINT ' + JSON.stringify(out));
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'print.json'), JSON.stringify(out, null, 2));
  process.exit(0);
} catch (err) {
  console.error('PRINT-FATAL ' + String(err?.stack ?? err).slice(0, 1000));
  fs.writeFileSync(path.join(OUT, 'print.json'), JSON.stringify(out, null, 2));
  await browser.close().catch(() => {});
  process.exit(1);
}
