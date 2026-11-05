// Focused navigation regression. Browser execution ONLY on the test server:
// remote-test.sh run <repo> -- node tools/e2e/navigation.js
// --extension-root <isolated-old-copy> --native-only demonstrates the real
// pre-patch redirect failure; --upgrade-from <old-copy> tests a saved profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const arg = (key) => { const i = process.argv.indexOf(key); return i < 0 ? null : path.resolve(process.argv[i + 1]); };
const OLD = arg('--upgrade-from');
const OUT = path.join(ROOT, 'tools/e2e/out/navigation');
fs.mkdirSync(OUT, {recursive: true});
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dwg-f25-'));
let extensionRoot = arg('--extension-root') || ROOT;
const changed = ['manifest.json', 'src/background/service-worker.js', 'src/viewer/viewer.js', 'src/content/links.js'];
if (OLD) {
  extensionRoot = path.join(temp, 'extension');
  for (const f of ['manifest.json', 'src', 'icons', '_locales']) fs.cpSync(path.join(ROOT, f), path.join(extensionRoot, f), {recursive: true});
  for (const f of changed) fs.copyFileSync(path.join(OLD, f), path.join(extensionRoot, f));
}
const bytes = fs.readFileSync(path.join(ROOT, 'tools/e2e/fixtures/acadsharp/sample_AC1015.dwg'));
const hits = [];
let retryAllowed = false;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');
  hits.push({url: req.url, dest: req.headers['sec-fetch-dest'] ?? null});
  if (u.pathname === '/site.html') {
    res.setHeader('Content-Type', 'text/html');
    return res.end('<!doctype html><a id="drawing" href="/plan.dwg?source=click">Drawing</a><a id="retry" href="/retry.dwg">Retry</a>');
  }
  if (u.pathname === '/redirect') {res.writeHead(302, {Location: '/plan.dwg?source=click'}); return res.end();}
  if (u.pathname.endsWith('.dwg')) {
    if (u.pathname === '/retry.dwg' && !retryAllowed) {res.writeHead(403); return res.end('denied');}
    res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Content-Disposition': 'attachment; filename="plan.dwg"'});
    return res.end(bytes);
  }
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const FILE = `${SITE}/plan.dwg?source=click`;
const records = [];
let browser, worker, extId, cdp;
let downloads = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {if (await fn()) return; await wait(100);}
  throw Error(`Timed out: ${label}`);
};
const check = async (name, fn) => {
  try {const detail = await fn(); records.push({name, ok: true, detail}); console.log(`PASS ${name} ${JSON.stringify(detail ?? {})}`);}
  catch (e) {records.push({name, ok: false, error: e.message}); console.log(`FAIL ${name} ${e.stack}`); throw e;}
};
const sw = (fn, ...args) => worker.evaluate(fn, ...args);
const tabs = () => sw(() => chrome.tabs.query({}));
const viewerTabs = async () => (await tabs()).filter((t) => (t.pendingUrl || t.url || '').includes('/src/viewer/viewer.html'));
async function launch() {
  browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH, headless: true, enableExtensions: true,
    userDataDir: path.join(temp, 'profile'), protocolTimeout: 60000,
    args: ['--lang=en-US', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
      ...(OLD ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`])]});
  if (OLD) {
    // Use the supported unpacked debugging API for the update fixture, as the
    // existing pre-install E2E does. This is not a CWS-signed package update.
    extId = await browser.installExtension(extensionRoot);
    const wakeInstalled = await browser.newPage();
    await wakeInstalled.goto(`chrome-extension://${extId}/src/viewer/viewer.html`, {waitUntil: 'load'});
    await wakeInstalled.close();
  }
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), {timeout: 30000});
  worker = await target.worker(); extId = new URL(target.url()).host;
  cdp = await browser.target().createCDPSession();
  downloads = [];
  cdp.on('Browser.downloadWillBegin', (d) => downloads.push({...d, state: 'started'}));
  cdp.on('Browser.downloadProgress', (d) => {const item = downloads.find((x) => x.guid === d.guid); if (item) item.state = d.state;});
  await cdp.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: path.join(temp, 'downloads'), eventsEnabled: true});
  // Prevent welcome-page requests from obscuring the bounded local stand.
  for (const p of await browser.pages()) if (/github\.io/.test(p.url())) await p.close();
}
const nativeGoto = async (page, url) => {
  try {await page.goto(url, {waitUntil: 'load', timeout: 20000});}
  catch (e) {if (!String(e).includes('net::ERR_ABORTED')) throw e;}
};
const expectNative = async (name, act, expectedDest = 'document') => check(name, async () => {
  const beforeTabs = (await viewerTabs()).map((t) => t.id);
  const beforeHits = hits.filter((h) => h.url === '/plan.dwg?source=click').length;
  const beforeDownloads = downloads.length;
  await act();
  const observed = (await tabs()).map((t) => ({id: t.id, url: t.pendingUrl || t.url || ''}));
  console.log(`OBSERVE ${name} ${JSON.stringify({tabs: observed, sourceHits: hits.filter((h) => h.url === '/plan.dwg?source=click').slice(beforeHits), downloads: [beforeDownloads, downloads.length]})}`);
  assert.ok(!observed.some((t) => t.url.includes('viewer.html#raw=')), 'obsolete F25 redirect intercepted native navigation');
  await until(() => downloads.length > beforeDownloads && downloads.at(-1).state === 'completed', `${name}: native download`);
  assert.deepEqual((await viewerTabs()).map((t) => t.id), beforeTabs, 'navigation must not create/replace a viewer');
  const requests = hits.filter((h) => h.url === '/plan.dwg?source=click').slice(beforeHits);
  assert.equal(requests.length, 1, 'exactly one source request');
  assert.equal(requests[0].dest, expectedDest, 'native action request destination');
  return {viewerIdsBefore: beforeTabs, viewerIdsAfter: (await viewerTabs()).map((t) => t.id), requests, downloads: [beforeDownloads, downloads.length]};
});
const VIEWER = () => `chrome-extension://${extId}/src/viewer/viewer.html`;
let fatal;
try {
  await launch();
  if (arg('--extension-root')) {
    await check('old-control.real-1.0.0-redirect-rule-is-active', async () => {
      assert.equal(await sw(() => chrome.runtime.getManifest().version), '1.0.0');
      await until(async () => (await sw(() => chrome.declarativeNetRequest.getDynamicRules())).length > 0, 'old control redirect rule registration');
      const rules = await sw(() => chrome.declarativeNetRequest.getDynamicRules());
      assert.equal(rules[0]?.action?.type, 'redirect');
      return {rules};
    });
  }
  if (OLD) {
    await check('upgrade.seed-real-1.0.0-dynamic-and-session-rules', async () => {
      await until(async () => (await sw(() => chrome.declarativeNetRequest.getDynamicRules())).length > 0, 'old redirect rule');
      const p = await browser.newPage();
      await p.goto(VIEWER(), {waitUntil: 'load'});
      await p.evaluate((u) => chrome.runtime.sendMessage({type: 'download-instead', url: u}), `${SITE}/seed.dwg`);
      await until(async () => (await sw(() => chrome.declarativeNetRequest.getSessionRules())).length > 0, 'old download bypass rule');
      const r = await sw(async () => ({version: chrome.runtime.getManifest().version,
        dynamic: await chrome.declarativeNetRequest.getDynamicRules(), session: await chrome.declarativeNetRequest.getSessionRules()}));
      assert.equal(r.version, '1.0.0'); assert.equal(r.dynamic.length, 1); assert.equal(r.session.length, 1);
      return r;
    });
    for (const f of changed) fs.copyFileSync(path.join(ROOT, f), path.join(extensionRoot, f));
    // Reload in the SAME browser session/profile: both old dynamic rules and
    // the still-live 60 s session bypass existed immediately before upgrade.
    await sw(() => {setTimeout(() => chrome.runtime.reload(), 0); return true;});
    // Target object identity is not a version discriminator. Read the actual
    // manifest from every matching live worker, waking a dormant one via a page.
    const wake = await browser.newPage();
    try {await wake.goto(VIEWER(), {waitUntil: 'load'});}
    catch (e) {
      console.log('OBSERVE upgrade.wake-error ' + e.message);
      const diagnostics = await browser.newPage();
      await diagnostics.goto('chrome://extensions/', {waitUntil: 'load'});
      const info = await diagnostics.evaluate(async () => {
        try {return await chrome.developerPrivate.getExtensionsInfo({includeDisabled: true, includeTerminated: true});}
        catch (err) {return {error: err.message};}
      });
      console.log('OBSERVE upgrade.extension-info ' + JSON.stringify(Array.isArray(info) ? info.map(({id, state, version, disableReasons, manifestErrors, runtimeErrors}) => ({id, state, version, disableReasons, manifestErrors, runtimeErrors})) : info));
      await diagnostics.close();
      const extension = Array.isArray(info) ? info.find((x) => x.id === extId) : null;
      if (extension?.state === 'DISABLED') {
        throw new Error(`Upgrade NOT VERIFIED: Chrome disabled unpacked reload; version=${extension.version}; disableReasons=${JSON.stringify(extension.disableReasons)}`);
      }
    }
    let reloadObservation = null;
    try {
      await until(async () => {
        for (const t of browser.targets().filter((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`))) {
          try {
            const candidate = await t.worker();
            reloadObservation = await candidate.evaluate(async () => ({version: chrome.runtime.getManifest().version, permissions: await chrome.permissions.getAll()}));
            if (reloadObservation.version === '1.0.1') {worker = candidate; return true;}
          } catch (e) {reloadObservation = {contextError: e.message};}
        }
        return false;
      }, 'reloaded manifest must be 1.0.1');
    } finally {console.log('OBSERVE upgrade.reload ' + JSON.stringify(reloadObservation));}
    await wake.close();
    await check('upgrade.same-profile-now-1.0.1-without-DNR-permission', async () => {
      const r = await sw(async () => ({version: chrome.runtime.getManifest().version, permissions: await chrome.permissions.getAll()}));
      assert.equal(r.version, '1.0.1');
      assert.ok(!r.permissions.permissions.some((p) => p.startsWith('declarativeNetRequest')));
      return r;
    });
  }
  // Run this first so the negative control fails on actual old redirect behavior,
  // not just on the old manifest's permission string.
  const direct = await browser.newPage();
  await expectNative('direct.goto.same-drawing-URL-is-native', () => nativeGoto(direct, FILE));
  await direct.close();
  if (!process.argv.includes('--native-only')) {
    await check('installed.permissions-exact-and-viewer-private', async () => {
      const r = await sw(async () => ({manifest: chrome.runtime.getManifest(), granted: await chrome.permissions.getAll()}));
      assert.deepEqual(r.granted.permissions.sort(), ['contextMenus', 'scripting', 'storage']);
      assert.deepEqual(r.manifest.host_permissions.sort(), ['http://*/*', 'https://*/*']);
      assert.ok(!r.manifest.web_accessible_resources?.length);
      return {version: r.manifest.version, permissions: r.granted.permissions};
    });
    const site = await browser.newPage();
    await site.goto(`${SITE}/site.html`, {waitUntil: 'load'});
    const sourceTab = async () => (await tabs()).find((t) => t.url === `${SITE}/site.html`);
    const clickViewer = async (name, opts = {}, modifier = null) => check(name, async () => {
      await site.bringToFront();
      const before = await viewerTabs();
      const origin = await sourceTab();
      const created = browser.waitForTarget((t) => t.type() === 'page' && t.url().startsWith(VIEWER() + '#src='), {timeout: 15000});
      if (modifier) await site.keyboard.down(modifier);
      try {await site.click('#drawing', opts);} finally {if (modifier) await site.keyboard.up(modifier);}
      const p = await (await created).page();
      await p.waitForFunction(() => location.href.includes('/src/viewer/viewer.html#src='), {polling: 100});
      const after = await viewerTabs();
      assert.equal(after.length, before.length + 1);
      const added = after.find((t) => !before.some((b) => b.id === t.id));
      assert.equal(added.index, origin.index + 1); assert.equal(added.windowId, origin.windowId);
      assert.equal(added.active, !['Control', 'Meta'].includes(modifier) && opts.button !== 'middle');
      assert.equal(site.url(), `${SITE}/site.html`);
      assert.equal(decodeURIComponent(new URL(p.url()).hash.slice(5)), FILE);
      console.log(`OBSERVE ${name} ${JSON.stringify({activeBeforeFocus: added.active, index: added.index, sourceIndex: origin.index})}`);
      // Assert background semantics BEFORE focus. Then activate as a user would:
      // background tabs throttle animation frames used by the drawing engine.
      await p.bringToFront();
      await p.waitForFunction(() => ['view', 'error'].includes(document.body.dataset.state), {timeout: 60000});
      assert.equal(await p.evaluate(() => document.body.dataset.state), 'view');
      await p.close();
      return {viewerCount: [before.length, after.length], sourceIndex: origin.index, viewerIndex: added.index, active: added.active};
    });
    await clickViewer('click.real-mouse-opens-adjacent-viewer');
    await clickViewer('click.ctrl-keeps-viewer-in-background', {}, 'Control');
    await clickViewer('click.middle-keeps-viewer-in-background', {button: 'middle'});
    await clickViewer('click.shift-opens-active-viewer', {}, 'Shift');
    await expectNative('navigation.script-location-is-native', () => site.evaluate((u) => location.assign(u), FILE));
    const redirect = await browser.newPage();
    await expectNative('navigation.http-redirect-is-native', () => nativeGoto(redirect, `${SITE}/redirect`));
    await redirect.close();
    await site.bringToFront();
    await expectNative('click.alt-stays-native', async () => {
      await site.keyboard.down('Alt');
      try {await site.click('#drawing');} finally {await site.keyboard.up('Alt');}
    }, 'empty'); // Chrome's native Alt-download is not a document navigation.
    await sw(() => chrome.storage.local.set({interceptLinks: false})); await wait(200);
    await expectNative('click.toggle-off-stays-native', () => site.click('#drawing'));
    await sw(() => chrome.storage.local.set({interceptLinks: true})); await wait(200);
    await clickViewer('click.toggle-on-without-reload');
    await check('download-instead.real-button-one-native-request-same-tab', async () => {
      const before = await viewerTabs();
      const target = browser.waitForTarget((t) => t.type() === 'page' && t.url().includes('viewer.html#src='));
      await site.click('#retry');
      const p = await (await target).page();
      await p.waitForFunction(() => document.body.dataset.state === 'error');
      const retryTab = (await viewerTabs()).find((t) => !before.some((b) => b.id === t.id));
      assert.ok(retryTab);
      const sourceBefore = hits.filter((h) => h.url === '/retry.dwg').length;
      const downloadBefore = downloads.length;
      const allIds = (await tabs()).map((t) => t.id);
      retryAllowed = true;
      await p.click('#errDownloadBtn');
      await until(() => downloads.length > downloadBefore && downloads.at(-1).state === 'completed', 'Download instead completed');
      const requests = hits.filter((h) => h.url === '/retry.dwg').slice(sourceBefore);
      assert.equal(requests.length, 1); assert.equal(requests[0].dest, 'document');
      const afterIds = (await tabs()).map((t) => t.id);
      assert.deepEqual(afterIds, allIds, 'no new/replaced tabs');
      const now = (await tabs()).find((t) => t.id === retryTab.id);
      assert.ok(now); assert.equal(now.windowId, retryTab.windowId);
      await p.close();
      return {requests, senderTab: retryTab.id, tabIdsBefore: allIds, tabIdsAfter: afterIds, downloads: [downloadBefore, downloads.length]};
    });
    await check('viewer.rejects-raw-and-invalid-src-without-fetch', async () => {
      const p = await browser.newPage();
      const before = hits.length;
      for (const hash of [`#raw=${FILE}`, '#src=' + encodeURIComponent('file:///tmp/plan.dwg'), '#src=' + encodeURIComponent(`${SITE}/not-a-drawing.txt`), '#src=not%20a%20url']) {
        // Reload because hash-only navigation does not reinitialize the viewer.
        await p.goto(VIEWER() + hash, {waitUntil: 'load'}); await p.reload({waitUntil: 'load'});
        assert.equal(await p.evaluate(() => document.body.dataset.state), 'start', hash);
      }
      assert.equal(hits.length, before, 'rejected hashes never reach network');
      await p.close(); return {rejected: 4, sourceRequests: 0};
    });
    await site.close();
  }
} catch (e) {fatal = e;}
finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
  fs.writeFileSync(path.join(OUT, OLD ? 'upgrade.json' : process.argv.includes('--native-only') ? 'native-control.json' : 'current.json'), JSON.stringify({records, hits, downloads, error: fatal?.message ?? null}, null, 2));
  fs.rmSync(temp, {recursive: true, force: true});
}
const expected = (process.argv.includes('--native-only') ? 1 : 13) + (OLD ? 2 : 0) + (arg('--extension-root') ? 1 : 0);
console.log(`navigation-browser: ${records.filter((r) => r.ok).length}/${expected} passed; attempted=${records.length}; pending=${expected - records.length}; skips=0; suite=${process.argv.includes('--native-only') ? 'native-only' : 'full'}`);
if (fatal) {console.error(fatal.message); process.exitCode = 1;}
