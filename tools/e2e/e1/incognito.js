// 4.2.14 fallback check (ТЗ: "если вьюер уходит в обычное окно — в инкогнито
// перехват не делаем, ссылка скачивается как обычно"). Granting incognito
// access from a headless harness restarts the extension and the harness loses
// its service worker (E1 calls 1–2, 2 runs of 2 hung), so this script checks
// the fallback state instead: the extension WITHOUT incognito access (Chrome's
// default after install).
//   1. Regular window, link to .dwg on a page -> the viewer tab opens (control).
//   2. Off-the-record context (Target.createBrowserContext, the same profile
//      type as an incognito window), the same link -> no viewer tab, the file
//      is downloaded as is.
//   3. The downloaded file opened from disk in the regular viewer -> drawn.
// Plain HTTP on a.test (mapped to 127.0.0.1): no cert fixture needed.
//   node tools/e2e/e1/incognito.js <fixture.dwg>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, extensionId, ensureOut, finish } from './lib.js';

const fixture = path.resolve(process.argv[2]);
const bytes = fs.readFileSync(fixture);
const log = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/page.html') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(`<!doctype html><title>files</title><p><a id="lnk" href="/files/plan.dwg">plan.dwg</a></p>`);
  }
  if (u.pathname.endsWith('.dwg')) {
    log.push({ path: u.pathname + u.search, at: Date.now() });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', bytes.length);
    return res.end(bytes);
  }
  res.statusCode = 404;
  res.end('nf');
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const A = `http://a.test:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchWithExtension(['--host-resolver-rules=MAP a.test 127.0.0.1']);
const out = { port, chrome: await browser.version() };
const say = (k, v) => {
  out[k] = v;
  console.log('INCOG ' + k + ' ' + JSON.stringify(v).slice(0, 600));
};
const viewerTargets = (extId) =>
  browser
    .targets()
    .filter((t) => t.type() === 'page' && t.url().startsWith(`chrome-extension://${extId}/src/viewer/viewer.html`))
    .map((t) => t.url().slice(0, 140));
try {
  const extId = await extensionId(browser);
  const sw = await browser
    .targets()
    .find((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`))
    .worker();
  say('allowedIncognito', await sw.evaluate(() => chrome.extension.isAllowedIncognitoAccess()));
  say('manifestIncognito', await sw.evaluate(() => chrome.runtime.getManifest().incognito ?? 'spanning (default)'));

  // 1. Regular window (control): the click opens the viewer.
  const p = await browser.newPage();
  await p.goto(`${A}/page.html`);
  await sleep(800);
  const before1 = viewerTargets(extId).length;
  await p.click('#lnk');
  let regularViewer = [];
  for (let i = 0; i < 40 && regularViewer.length <= before1; i++) {
    await sleep(250);
    regularViewer = viewerTargets(extId);
  }
  say('regular', { viewerTabs: regularViewer.length - before1, url: regularViewer.at(-1) ?? null, serverHits: log.length });

  // 2. Off-the-record context: no extension, the link downloads.
  const ctx = await browser.createBrowserContext();
  const dl = ensureOut('incognito-dl');
  for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f), { force: true });
  const cdp = await browser.target().createCDPSession();
  const events = [];
  cdp.on('Browser.downloadWillBegin', (e) => events.push({ ev: 'begin', file: e.suggestedFilename, url: e.url }));
  cdp.on('Browser.downloadProgress', (e) => {
    if (e.state !== 'inProgress') events.push({ ev: e.state, bytes: e.receivedBytes });
  });
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    browserContextId: ctx.id,
    downloadPath: dl,
    eventsEnabled: true,
  });
  const ip = await ctx.newPage();
  await ip.goto(`${A}/page.html`);
  await sleep(800);
  const hits0 = log.length;
  const before2 = viewerTargets(extId).length;
  await ip.click('#lnk');
  for (let i = 0; i < 60 && !events.some((e) => e.ev === 'completed' || e.ev === 'canceled'); i++) await sleep(250);
  await sleep(500);
  const files = fs.readdirSync(dl).map((f) => ({ f, bytes: fs.statSync(path.join(dl, f)).size }));
  say('incognito', {
    viewerTabs: viewerTargets(extId).length - before2,
    pageUrlAfter: ip.url(),
    serverHits: log.length - hits0,
    events,
    files,
    fixtureBytes: bytes.length,
  });
  await ctx.close();

  // 3. The downloaded file from disk in the regular viewer.
  const got = files.find((x) => x.bytes === bytes.length);
  if (got) {
    const v = await browser.newPage();
    await v.setViewport({ width: 1280, height: 900 });
    await v.goto(`chrome-extension://${extId}/src/viewer/viewer.html`);
    await (await v.waitForSelector('#fileInput', { timeout: 10000 })).uploadFile(path.join(dl, got.f));
    await v.waitForFunction(
      () => !document.getElementById('drawnPill').hidden || !document.getElementById('error').hidden,
      { timeout: 90000, polling: 250 },
    );
    await sleep(1000);
    say('fromDisk', await v.evaluate(() => ({
      ok: document.getElementById('error').hidden,
      pill: document.getElementById('drawnPill').textContent,
      title: document.title,
    })));
    await v.screenshot({ path: path.join(ensureOut('screens'), 'incognito_fromDisk.png') });
  } else {
    say('fromDisk', { skipped: 'no downloaded file of fixture size' });
  }
  await browser.close();
  server.close();
  finish([out], 'incognito.json', {});
  process.exit(0);
} catch (err) {
  console.error('INCOG-FATAL ' + String(err?.stack ?? err).slice(0, 600));
  await browser.close().catch(() => {});
  server.close();
  process.exit(1);
}
