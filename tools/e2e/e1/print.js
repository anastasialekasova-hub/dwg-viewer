// 4.2.13: tab title = default PDF name, zero @page margins drop Chrome's
// header/footer, WebGL limits for the snapshot. Prints the open drawing with
// header/footer templates that mimic Chrome's print dialog (title + URL) and
// writes the PDFs for text extraction.
//   node tools/e2e/e1/print.js <file>
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, extensionId, viewerPage, armPage, finish, ensureOut, safeName } from './lib.js';

const fileArg = path.resolve(process.argv[2]);
const name = path.basename(fileArg);
const browser = await launchWithExtension();
try {
  const extId = await extensionId(browser);
  const page = await viewerPage(browser, extId, {});
  await armPage(page);
  await page.bringToFront();
  const t0 = Date.now();
  const chooser = await page.waitForSelector('#fileInput', { timeout: 10000 });
  await chooser.uploadFile(fileArg);
  await page.waitForFunction(() => {
    const ok = document.getElementById('drawnPill');
    const err = document.getElementById('error');
    return (ok && !ok.hidden) || (err && !err.hidden);
  }, { timeout: 90000, polling: 250 });
  const opened = { ms: Date.now() - t0, ok: await page.evaluate(() => document.getElementById('error').hidden) };
  await new Promise((r) => setTimeout(r, 1500));
  const title = await page.title();
  // Switch to the first paper layout tab (if any) and read the title again.
  const tabs = await page.$$('#layoutTabs .stab');
  let paperTitle = null;
  if (tabs.length > 1) {
    await tabs[1].click();
    await new Promise((r) => setTimeout(r, 2500));
    paperTitle = await page.title();
    await tabs[0].click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    const dbg = g.getExtension('WEBGL_debug_renderer_info');
    const out = {
      renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
      vendor: dbg ? g.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : g.getParameter(g.VENDOR),
      MAX_RENDERBUFFER_SIZE: g.getParameter(g.MAX_RENDERBUFFER_SIZE),
      MAX_TEXTURE_SIZE: g.getParameter(g.MAX_TEXTURE_SIZE),
      MAX_VIEWPORT_DIMS: Array.from(g.getParameter(g.MAX_VIEWPORT_DIMS)),
      tries: [],
    };
    // Largest drawing buffer Chrome really allocates (it shrinks silently).
    for (const n of [2048, 4096, 8192, 16384, 32768]) {
      const cc = document.createElement('canvas');
      cc.width = n; cc.height = Math.round(n * 0.707);
      const gg = cc.getContext('webgl2', { preserveDrawingBuffer: true });
      if (!gg) { out.tries.push({ n, ctx: false }); continue; }
      gg.clearColor(1, 0, 0, 1); gg.clear(gg.COLOR_BUFFER_BIT);
      const px = new Uint8Array(4);
      gg.readPixels(gg.drawingBufferWidth - 1, gg.drawingBufferHeight - 1, 1, 1, gg.RGBA, gg.UNSIGNED_BYTE, px);
      out.tries.push({ n, w: gg.drawingBufferWidth, h: gg.drawingBufferHeight, px: Array.from(px) });
      gg.getExtension('WEBGL_lose_context')?.loseContext();
    }
    const main = document.querySelector('#cad canvas');
    out.mainCanvas = main ? { w: main.width, h: main.height, dpr: devicePixelRatio } : null;
    return out;
  });
  const swT = browser.targets().find((x) => x.type() === 'service_worker' && x.url().startsWith(`chrome-extension://${extId}/`));
  const sw = await swT.worker();
  const commands = await sw.evaluate(() => chrome.commands.getAll());
  console.log('COMMANDS ' + JSON.stringify(commands));
  const dir = ensureOut('print');
  const hf = {
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:9px;width:100%">HDR <span class="title"></span> <span class="url"></span></div>',
    footerTemplate: '<div style="font-size:9px;width:100%">FTR <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  };
  const pdfs = {};
  // With the viewer's CSS (@page margin 0) and Chrome honouring CSS page size/margins.
  pdfs.zero = path.join(dir, `print-zero_${safeName(name)}.pdf`);
  await page.pdf({ path: pdfs.zero, format: 'A4', landscape: true, preferCSSPageSize: true, printBackground: true, ...hf });
  // Control: the same with Chrome's default 1 cm margins (no @page override).
  await page.addStyleTag({ content: '@page { margin: 1cm !important; }' });
  pdfs.margin = path.join(dir, `print-margin_${safeName(name)}.pdf`);
  await page.pdf({ path: pdfs.margin, format: 'A4', landscape: true, preferCSSPageSize: true, printBackground: true, ...hf });
  const shot = path.join(ensureOut('screens'), `print_${safeName(name)}.png`);
  await page.screenshot({ path: shot });
  const sizes = Object.fromEntries(Object.entries(pdfs).map(([k, p]) => [k, fs.statSync(p).size]));
  const res = { file: name, commands, opened, title, paperTitle, gl, sizes, pdfs, shot };
  console.log('PRINT ' + JSON.stringify(res));
  await browser.close();
  finish([res], `print-${safeName(name)}.json`, {});
  process.exit(0);
} catch (err) {
  console.error('PRINT-FATAL ' + String(err?.stack ?? err).slice(0, 600));
  await browser.close().catch(() => {});
  process.exit(1);
}
