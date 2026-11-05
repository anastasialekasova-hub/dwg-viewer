// Source-link fetch flow: serve a fixture over local http and load the
// encoded #src route for sizing. --direct remains accepted for old batch plans.
// Actual click and native file navigation are tested in ../navigation.js.
//   CHROME_PATH=... node tools/e2e/e1/open-link.js <file-in-root> [--direct] [--tag <t>]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  launchWithExtension,
  extensionId,
  viewerPage,
  armPage,
  armAuto,
  engineSnapshot,
  cspViolations,
  externalRequests,
  finish,
  ensureOut,
  safeName,
  OPEN_LIMIT_S,
} from './lib.js';

const fileArg = path.resolve(process.argv[2]);
const tagIdx = process.argv.indexOf('--tag');
const tag = tagIdx > -1 ? process.argv[tagIdx + 1] : 'link';
const fname = path.basename(fileArg);

const serverLog = [];
const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  serverLog.push({
    url: req.url,
    cookie: headers.cookie ?? null,
    authorization: headers.authorization ?? null,
    origin: headers.origin ?? null,
  });
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
const page = await viewerPage(browser, extId, capture);
await armPage(page); // current document (covers --direct, which stays in-page)
await armAuto(page); // future documents (--direct source route)
const t0 = Date.now();
const row = { file: fname, sizeKB: Math.round(fs.statSync(fileArg).size / 1024), mode: 'explicit-#src' };

await page.goto(`chrome-extension://${extId}/src/viewer/viewer.html#src=${encodeURIComponent(fileUrl)}`, { waitUntil: 'load' });
try {
  await page.waitForFunction(
    () => {
      const ok = document.getElementById('drawnPill');
      const err = document.getElementById('error');
      return (ok && !ok.hidden) || (err && !err.hidden);
    },
    { timeout: OPEN_LIMIT_S * 1000 + 30000, polling: 300 },
  );
  row.ok = await page.evaluate(() => document.getElementById('error').hidden);
  if (!row.ok) {
    row.errTitle = await page.evaluate(() => document.getElementById('errTitle')?.textContent ?? '');
  }
  await page.evaluate(() => window.__stopMem());
  const snap = await engineSnapshot(page);
  Object.assign(row, {
    total: snap.counts.total,
    drawn: snap.counts.drawn,
    layouts: snap.layouts.length,
    hasCanvas: snap.hasCanvas,
  });
  row.ms_open = await page.evaluate(() => Math.round(performance.now() - window.__openStart));
} catch (e) {
  row.ok = false;
  row.timeout = true;
  row.catchErr = String(e).slice(0, 300);
}
if (!row.ok) {
  row.failedReq = capture.requests.filter((r) => r.startsWith('FAILED')).slice(0, 5);
  row.consoleFirst = capture.console.slice(0, 6).map((c) => `[${c.type}] ${c.text.slice(0, 200)}`);
}
row.ms_total = Date.now() - t0;
row.finalUrl = page.url().slice(0, 120);
row.urlIsExtension = page.url().startsWith('chrome-extension://');
row.srcInUrl = page.url().includes('#src=');
const mem = await page.evaluate(() => window.__stopMem?.() ?? { peak: 0 }).catch(() => ({ peak: 0 }));
row.heapPeakMB = Math.round(mem.peak / 1048576);
row.cookies = await page.cookies().then((cs) => cs.map((c) => `${c.domain}${c.name}`));
row.serverSaw = serverLog;
row.csp = cspViolations(capture).length;
row.extRequests = externalRequests(capture).length;
const shotDir = ensureOut('screens');
const shot = path.join(shotDir, `link_${safeName(fname)}_${tag}.png`);
await page.screenshot({ path: shot }).catch(() => {});
row.shot = path.relative(process.cwd(), shot);
await browser.close();
server.close();

const rows = [row];
finish(rows, `open-link-${tag}.json`, { fileUrl });
console.log('SERVERLOG ' + JSON.stringify(serverLog));
process.exit(row.ok && row.srcInUrl ? 0 : 1);
