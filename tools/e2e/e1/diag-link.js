// Diagnose the link-flow open stall: dump every captured request (full URLs)
// and poll engine counters right after the encoded #src= open starts, so we can see
// which waitUntilIdle gate (_numOfEntitiesToProcess vs _pendingGeometryJobs)
// stays busy, or which fetch hangs.
//   CHROME_PATH=... node tools/e2e/e1/diag-link.js <file> [--direct]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  launchWithExtension,
  extensionId,
  viewerPage,
  armPage,
  armAuto,
} from './lib.js';

const fileArg = path.resolve(process.argv[2]);
const fname = path.basename(fileArg);

const serverLog = [];
const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  serverLog.push({ url: req.url, cookie: headers.cookie ?? null });
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': fs.statSync(fileArg).size,
    'content-disposition': `attachment; filename="${fname}"`,
  });
  fs.createReadStream(fileArg).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const fileUrl = `http://127.0.0.1:${port}/${encodeURIComponent(fname)}`;

const browser = await launchWithExtension();
const extId = await extensionId(browser);
const capture = {};
try {
  const page = await viewerPage(browser, extId, capture);
  await armPage(page);
  await armAuto(page);
  // This diagnostic exercises explicit viewer fetches, not native navigation.
  await page.goto(`chrome-extension://${extId}/src/viewer/viewer.html#src=${encodeURIComponent(fileUrl)}`, { waitUntil: 'load', timeout: 30000 });
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const tick = await page
      .evaluate(async () => {
        const m = await import(chrome.runtime.getURL('src/viewer/engine.js'));
        let view = null;
        try {
          // engine.js keeps manager module-private; counts()/isProcessing()
          // are the exported surface over curView.
          view = {
            counts: m.counts(),
            processing: m.isProcessing(),
          };
        } catch (e) {
          view = { err: String(e).slice(0, 120) };
        }
        const ok = document.getElementById('drawnPill');
        const err = document.getElementById('error');
        return {
          t: Math.round(performance.now()),
          ...view,
          drawnVisible: Boolean(ok && !ok.hidden),
          errVisible: Boolean(err && !err.hidden),
          errTitle: err && !err.hidden ? document.getElementById('errTitle')?.textContent : null,
        };
      })
      .catch((e) => ({ tickErr: String(e).slice(0, 120) }));
    console.log('TICK ' + JSON.stringify(tick));
    if (tick.errVisible || tick.drawnVisible) break;
  }
  console.log('REQUESTS ' + JSON.stringify(capture.requests));
  console.log('SERVERLOG ' + JSON.stringify(serverLog));
} catch (e) {
  console.log('DIAG-FATAL ' + String(e).slice(0, 300));
} finally {
  await browser.close().catch(() => {});
  server.close();
  process.exit(0);
}
