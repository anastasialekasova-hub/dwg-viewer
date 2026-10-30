// One-page probe for the layers panel visibility (Э2 follow-up): clicks the
// Layers button and dumps every fact that decides display. Test server only:
//   node tools/e2e/e2/panel-probe.js <fixture.dwg>
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, extensionId, viewerPage } from '../e1/lib.js';

const ROOT = process.cwd();
const fixture = path.resolve(process.argv[2] ?? path.join(ROOT, 'tools', 'e2e', 'fixtures', 'acadsharp', 'sample_AC1015.dwg'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchWithExtension();
try {
  const extId = await extensionId(browser);
  const capture = {};
  const page = await viewerPage(browser, extId, capture);
  await page.evaluate(async (rel) => {
    const buf = await (await fetch(chrome.runtime.getURL(rel))).arrayBuffer();
    const dt = new DataTransfer();
    dt.items.add(new File([buf], rel.split('/').pop()));
    const inp = document.getElementById('fileInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, path.relative(ROOT, fixture));
  await page.waitForFunction(() => document.body.dataset.state === 'view', { timeout: 60000 });
  await sleep(1200);

  const before = await page.evaluate(() => {
    const p = document.getElementById('layersPanel');
    return {
      state: document.body.dataset.state,
      layersAttr: document.body.dataset.layers ?? '(unset)',
      panelHidden: p.hidden,
      panelDisplay: getComputedStyle(p).display,
      btnAria: document.getElementById('layersBtn').getAttribute('aria-pressed'),
      bodyAttrs: document.body.getAttribute('data-layers'),
    };
  });
  await page.evaluate(() => document.getElementById('layersBtn').click());
  await sleep(700);
  const after = await page.evaluate(() => {
    const p = document.getElementById('layersPanel');
    const cs = getComputedStyle(p);
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of list) {
        if (r.selectorText && /layersPanel/.test(r.selectorText)) rules.push(r.selectorText + ' -> ' + r.style.display);
        if (r.cssRules) {
          for (const rr of r.cssRules) {
            if (rr.selectorText && /layersPanel/.test(rr.selectorText)) rules.push('IN-MEDIA ' + rr.selectorText + ' -> ' + rr.style.display);
          }
        }
      }
    }
    return {
      layersAttr: document.body.dataset.layers,
      panelHidden: p.hidden,
      panelDisplay: cs.display,
      panelRect: JSON.stringify(p.getBoundingClientRect()),
      rules,
      parentDisplay: getComputedStyle(p.parentElement).display,
    };
  });
  console.log('PANEL-BEFORE ' + JSON.stringify(before));
  console.log('PANEL-AFTER ' + JSON.stringify(after));
  fs.mkdirSync(path.join(ROOT, 'tools', 'e2e', 'out', 'e1', 'screens'), { recursive: true });
  await page.screenshot({ path: path.join(ROOT, 'tools', 'e2e', 'out', 'e1', 'screens', 'panel-probe.png') });
  await browser.close();
  process.exit(0);
} catch (e) {
  console.error('PANEL-PROBE-FATAL ' + String(e?.stack ?? e).slice(0, 600));
  await browser.close().catch(() => {});
  process.exit(1);
}
