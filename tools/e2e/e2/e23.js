// Э2/Э3 e2e cases (ТЗ 10.2 №2–8, №10): link clicks, pre-install tabs,
// interception off, context menu, link errors, Download original, rating
// widget, lifecycle. Runs only on the test server via remote-test.sh:
//   node tools/e2e/e2/e23.js <fixture.dwg>
// One HTTPS stand (a.test) serves the page, files, errors and a download
// counter; the cert lives in fixtures-local/tls (not in git).
import puppeteer from 'puppeteer-core';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'tools', 'e2e', 'out', 'e2');
const fixture = path.resolve(process.argv[2] ?? path.join(ROOT, 'tools', 'e2e', 'fixtures', 'acadsharp', 'sample_AC1015.dwg'));
const FULLY_DRAWN = path.join(ROOT, 'tools', 'e2e', 'fixtures-local', 'real', 'mlightcad', 'map-of-uae.dwg');
const bytes = fs.readFileSync(fixture);
const sha = createHash('sha256').update(bytes).digest('hex');
const tls = path.join(ROOT, 'tools', 'e2e', 'fixtures-local', 'tls');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const DL = path.join(ROOT, 'tools', 'e2e', 'out', 'e2', 'downloads');
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const hits = [];
let mode403 = false;
let modeHtml = false;
let mode500 = false;
const server = https.createServer(
  { key: fs.readFileSync(path.join(tls, 'test.key')), cert: fs.readFileSync(path.join(tls, 'test.crt')) },
  (req, res) => {
    const u = new URL(req.url, 'https://a.test');
    const p = u.pathname;
    if (p.endsWith('.dwg') || p.endsWith('.dxf')) hits.push(p + u.search);
    hits.push(`ALL ${req.method} ${p}${u.search}`);
    if (p === '/site.html') {
      res.setHeader('Content-Type', 'text/html');
      const base = `https://a.test:${server.address().port}`;
      return res.end(`<!doctype html><html><body>
        <p><a id="plain" href="${base}/files/plan.dwg?via=plain">plan.dwg</a></p>
        <p><a id="withdownload" href="${base}/files/plan.dwg?via=download" download>plan download attr</a></p>
        <p><a id="blank" href="${base}/files/plan.dwg?via=blank" target="_blank">plan blank</a></p>
        <p><a id="alt" href="${base}/files/plan.dwg?via=alt">plan alt</a></p>
        <iframe id="fr" src="/frame.html"></iframe>
        <p><a id="pdf" href="${base}/files/doc.pdf">doc.pdf</a></p>
        <p><a id="err403" href="${base}/err/secret.dwg?via=403">secret.dwg</a></p>
        <p><a id="errhtml" href="${base}/err/login.dwg?via=html">login.dwg</a></p>
        <p><a id="err500" href="${base}/err/boom.dxf?via=500">boom.dxf</a></p>
        <p><a id="errbig" href="${base}/err/huge.dwg?via=big">huge.dwg</a></p>
        <p><a id="orig" href="${base}/files/orig.dwg?via=orig">orig.dwg</a></p>
      </body></html>`);
    }
    if (p === '/frame.html') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<!doctype html><html><body><p><a id="frlink" href="https://a.test:${server.address().port}/files/plan.dwg?via=frame">fr plan</a></p></body></html>`);
    }
    if (p.startsWith('/err/403') || p.startsWith('/err/secret')) {
      mode403 = true;
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('forbidden');
    }
    if (p.startsWith('/err/login')) {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><html><head><title>Sign in</title></head><body><form>login</form></body></html>');
    }
    if (p.startsWith('/err/boom')) {
      mode500 = true;
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('boom');
    }
    if (p.startsWith('/err/huge')) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(21 * 1000 * 1000)); // over LINK_LIMIT_MB=20
      return res.end(bytes);
    }
    if (p.startsWith('/files/') || p.startsWith('/err/')) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(bytes.length));
      if (p.includes('orig')) res.setHeader('Content-Disposition', 'attachment; filename="Orig Name.dwg"');
      return res.end(bytes);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('nf');
  },
);
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const PORT = server.address().port;
const SITE = `https://a.test:${PORT}`;

const results = {};
const note = (k, v) => {
  results[k] = v;
  console.log('CASE ' + k + ' ' + JSON.stringify(v).slice(0, 700));
};
const dlFiles = () => fs.readdirSync(DL).filter((f) => !f.endsWith('.crdownload'));

const LAUNCH = (withExt) =>
  puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    protocolTimeout: 60000,
    args: [
      '--lang=en-US',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--enable-unsafe-swiftshader',
      '--host-resolver-rules=MAP a.test 127.0.0.1',
      '--ignore-certificate-errors',
      ...(withExt ? [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] : []),
    ],
  });

const browser = await LAUNCH(true);
try {
  const extId = await (async () => {
    for (let i = 0; i < 200; i++) {
      const sw = browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      if (sw) return new URL(sw.url()).host;
      await sleep(100);
    }
    throw new Error('no extension sw target');
  })();
  const swEval = async (fn, ...args) => {
    for (let i = 0; i < 100; i++) {
      const t = browser.targets().find((x) => x.type() === 'service_worker' && x.url().startsWith(`chrome-extension://${extId}/`));
      if (t) return (await t.worker()).evaluate(fn, ...args);
      await sleep(100);
    }
    throw new Error('sw target lost');
  };
  const tabs = () => swEval(() => chrome.tabs.query({}).then((ts) => ts.map((t) => ({ id: t.id, index: t.index, url: (t.pendingUrl || t.url || '').slice(0, 120), active: t.active }))));
  const viewerTabs = async () => (await tabs()).filter((t) => t.url.startsWith('chrome-extension://'));
  const newPage = async () => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    const console_ = [];
    p.on('console', (m) => console_.push({ type: m.type(), text: m.text().slice(0, 300) }));
    p.on('pageerror', (e) => console_.push({ type: 'pageerror', text: String(e).slice(0, 300) }));
    p.__console = console_;
    return p;
  };
  // page.click() hangs intermittently on this Windows CfT setup (same
  // signature as the E1 first-fit hang: Runtime.callFunctionOn never
  // returns). Synthetic clicks work for our handlers — none of them checks
  // isTrusted — so they are the primary path; modifiers still need real
  // input and keep their own races.
  const jsClick = async (p, sel) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await Promise.race([
          p.evaluate((s) => document.querySelector(s)?.click(), sel),
          sleep(15000).then(() => Promise.reject(new Error(`jsClick ${sel} hang 15 s`))),
        ]);
      } catch (e) {
        if (attempt === 1) throw e;
        await sleep(1500);
      }
    }
  };
  const allowDownloads = async (p) => {
    const cdp = await p.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
  };
  const waitViewerSettled = (vp, ms = 45000) =>
    vp.waitForFunction(
      () => {
        const ok = document.body.dataset.state === 'view';
        const err = document.body.dataset.state === 'error';
        return ok || err;
      },
      { timeout: ms },
    );
  const pageConsoleErrs = (p) =>
    (p.__console ?? [])
      .filter((c) => c.type === 'error' || c.type === 'pageerror')
      .filter((c) => !/net::|ERR_/i.test(c.text));

  // ---------- case 2: link clicks ----------
  {
    hits.length = 0;
    const site = await newPage();
    await allowDownloads(site);
    await site.goto(`${SITE}/site.html`, { waitUntil: 'load' });
    const before = await tabs();
    const siteTabId = (await tabs()).find((t) => t.url.startsWith(SITE))?.id;
    if (siteTabId !== undefined) {
      const probe = await swEval(async (tabId) => {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const m = window[Symbol.for('dwg-viewer:content')];
            return { present: Boolean(m), state: typeof m?.state === 'function' ? m.state() : null };
          },
        });
        return r?.result;
      }, siteTabId);
      note('case2.contentScriptProbe', { siteTabId, ...probe });
    }
    await jsClick(site, '#plain');
    await sleep(2500);
    const ts1 = await tabs();
    const vt = ts1.filter((t) => t.url.includes('viewer.html'));
    const siteIndex = ts1.find((t) => t.url.startsWith(SITE))?.index;
    note('case2.plainClick', {
      newViewer: vt.length - before.filter((t) => t.url.includes('viewer.html')).length,
      rightOfSite: vt.some((t) => siteIndex !== undefined && t.index === siteIndex + 1),
      active: vt.some((t) => t.active),
      srcParam: decodeURIComponent(vt[0]?.url.split('#')[1] ?? '').slice(0, 60),
      siteStillThere: ts1.some((t) => t.url.startsWith(SITE)),
      fileRequests: hits.length,
    });
    const vp = await (async () => {
      for (const t of browser.targets()) {
        if (t.type() === 'page' && t.url().includes('viewer.html')) return t.page();
      }
      return null;
    })();
    if (vp) {
      note('case2.viewerTarget', { url: vp.url().slice(0, 140) });
      await waitViewerSettled(vp).catch(() => {});
      note('case2.viewerState', await vp.evaluate(() => ({
        state: document.body.dataset.state,
        srcbar: !document.getElementById('srcbar').hidden,
        srcHost: document.querySelector('#srcPath b')?.textContent,
        drawn: document.getElementById('drawnPill').textContent,
      })));
      note('case2.consoleErrs', pageConsoleErrs(vp).slice(0, 4));
    }
    // Ctrl+click → background; Alt+click → native; download attr; target=_blank; frame.
    const site2 = await newPage();
    await site2.goto(`${SITE}/site.html`, { waitUntil: 'load' });
    const before2 = (await viewerTabs()).length;
    await jsClick(site2, '#blank');
    await sleep(1500);
    note('case2.targetBlank', { newViewer: (await viewerTabs()).length - before2 });
    hits.length = 0;
    await site2.keyboard.down('Alt');
    await Promise.race([site2.click('#alt'), sleep(20000).then(() => Promise.reject(new Error('alt click hang 20 s')))]).catch(() => {});
    await site2.keyboard.up('Alt');
    await sleep(2500);
    note('case2.altClick', { newViewer: (await viewerTabs()).length - before2, downloads: dlFiles(), fileRequests: hits.length });
    // frame link
    try {
      const fr = site2.frames().find((f) => f.url().includes('frame.html'));
      if (fr) {
        await jsClick(fr, '#frlink');
        await sleep(2000);
      }
      note('case2.frameLink', { newViewer: (await viewerTabs()).length - before2 });
    } catch (e) {
      note('case2.frameLink', { err: String(e?.message ?? e).slice(0, 120) });
    }
    // download attribute → intercepted the same way (it is a .dwg link)
    try {
      hits.length = 0;
      await jsClick(site2, '#withdownload');
      await sleep(2000);
      note('case2.downloadAttr', { newViewer: (await viewerTabs()).length - before2, fileRequests: hits.filter((h) => !h.startsWith('ALL ')).length });
    } catch (e) {
      note('case2.downloadAttr', { err: String(e?.message ?? e).slice(0, 120) });
    }
    // ctrl+click opens in background
    try {
      await site2.keyboard.down('Control');
      await Promise.race([site2.click('#plain'), sleep(20000).then(() => Promise.reject(new Error('ctrl click hang 20 s')))]).catch(() => {});
      await site2.keyboard.up('Control');
      await sleep(2000);
      const vtCtrl = await viewerTabs();
      note('case2.ctrlClick', { newViewer: vtCtrl.length - before2 - 1, anyActive: vtCtrl.some((t) => t.active) });
    } catch (e) {
      note('case2.ctrlClick', { err: String(e?.message ?? e).slice(0, 120) });
    }
    await site2.close().catch(() => {});
    await site.close().catch(() => {});
    // close the viewer tabs opened by this case to keep later counts clean
    for (const t of await viewerTabs()) await swEval((id) => chrome.tabs.remove(id), t.id).catch(() => {});
    await sleep(500);
  }

  // ---------- case 3: tab opened before install ----------
  // Fresh browser without the extension, page open, extension loads via CDP.
  {
    const b2 = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
      protocolTimeout: 60000,
      args: [
        '--lang=en-US', '--mute-audio', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--enable-unsafe-swiftshader',
        '--enable-unsafe-extension-debugging',
        '--host-resolver-rules=MAP a.test 127.0.0.1', '--ignore-certificate-errors',
      ],
    });
    try {
      const site = await b2.newPage();
      site.__console = [];
      site.on('console', (m) => site.__console.push({ type: m.type(), text: m.text().slice(0, 300) }));
      site.on('pageerror', (e) => site.__console.push({ type: 'pageerror', text: String(e).slice(0, 300) }));
      await site.goto(`${SITE}/site.html`, { waitUntil: 'load' });
      const bcdp = await b2.target().createCDPSession();
      try {
        const loaded = await Promise.race([
          bcdp.send('Extensions.loadUnpacked', { path: ROOT }),
          sleep(45000).then(() => {
            throw new Error('loadUnpacked timed out after 45 s');
          }),
        ]);
        note('case3.loadUnpacked', { loaded: loaded ?? null });
      } catch (e) {
        note('case3.loadUnpacked', { err: String(e?.message ?? e).slice(0, 160) });
      }
      await sleep(3000);
      note('case3.swTarget', {
        sw: Boolean(b2.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'))),
        targets: b2.targets().map((t) => `${t.type()}`).join(','),
      });
      // loadUnpacked leaves the MV3 worker dormant; opening an extension page
      // wakes it, and its onInstalled then injects the open site tab (F-24).
      const helper = await b2.newPage();
      await helper.goto(`chrome-extension://chjnnacclclmmjgeljppiihomfdnldcd/src/viewer/viewer.html`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
      for (let i = 0; i < 50 && !b2.targets().find((t) => t.type() === 'service_worker'); i++) await sleep(200);
      note('case3.swAwake', { sw: Boolean(b2.targets().find((t) => t.type() === 'service_worker')) });
      await helper.close().catch(() => {});
      await sleep(1500);
      await site.click('#plain');
      await sleep(3000);
      const sw2 = b2.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      const ids = sw2 ? await sw2.worker().evaluate(() => chrome.tabs.query({}).then((ts) => ts.map((t) => (t.pendingUrl || t.url || '').slice(0, 90)))) : [];
      note('case3.afterInstallClick', { viewerTabs: ids.filter((u) => u.includes('viewer.html')).length, invalidInConsole: site.__console.some((c) => /Extension context invalidated/i.test(c.text)) });
      // update path: reload the extension, click again — exactly one new tab
      const beforeReload = ids.filter((u) => u.includes('viewer.html')).length;
      if (sw2) {
        await sw2.worker().evaluate(() => chrome.runtime.reload());
        await sleep(3000);
      }
      await site.click('#plain');
      await sleep(3000);
      const sw3 = b2.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      const ids2 = sw3 ? await sw3.worker().evaluate(() => chrome.tabs.query({}).then((ts) => ts.map((t) => (t.pendingUrl || t.url || '').slice(0, 90)))) : [];
      note('case3.afterReloadClick', {
        viewerTabs: ids2.filter((u) => u.includes('viewer.html')).length,
        newOnes: ids2.filter((u) => u.includes('viewer.html')).length - beforeReload,
        invalidInConsole: site.__console.some((c) => /Extension context invalidated/i.test(c.text)),
      });
    } finally {
      await b2.close().catch(() => {});
    }
  }

  // ---------- case 4: interception off ----------
  {
    await swEval(async () => {
      await chrome.storage.local.set({ interceptLinks: false });
      return true;
    });
    await sleep(800);
    const noDnrPermission = await swEval(async () => {
      const p = await chrome.permissions.getAll();
      return !p.permissions.some((x) => x.startsWith('declarativeNetRequest'));
    });
    if (!noDnrPermission) throw new Error('Unexpected request-interception permission');
    const site = await newPage();
    await allowDownloads(site);
    await site.goto(`${SITE}/site.html`, { waitUntil: 'load' });
    hits.length = 0;
    fs.rmSync(DL, { recursive: true, force: true });
    fs.mkdirSync(DL, { recursive: true });
    await site.click('#plain');
    await sleep(3500);
    note('case4.interceptOff', { newViewer: (await viewerTabs()).length, downloads: dlFiles(), fileRequests: hits.length, noDnrPermission });
    // toggle back on — live, without reload
    await swEval(async () => {
      await chrome.storage.local.set({ interceptLinks: true });
      return true;
    });
    await sleep(800);
    // No reload: the already-open content script observes storage.onChanged.
    const before = (await viewerTabs()).length;
    await site.click('#plain');
    await sleep(3000);
    note('case4.interceptOnAgain', { newViewer: (await viewerTabs()).length - before, noDnrPermission });
    await site.close().catch(() => {});
    for (const t of await viewerTabs()) await swEval((id) => chrome.tabs.remove(id), t.id).catch(() => {});
  }

  // ---------- case 5: context menu registered ----------
  {
    const res = await swEval(async () => {
      try {
        await chrome.contextMenus.update('open-in-viewer', {});
        // getAll is not exposed in this build; update resolving without error
        // means the menu item from onInstalled is still registered.
        return { ok: true, note: 'contextMenus.update resolved (getAll unavailable)' };
      } catch (e) {
        return { ok: false, err: String(e).slice(0, 200) };
      }
    });
    note('case5.contextMenu', res);
  }

  // ---------- case 6: link error cards + Try again + Download instead ----------
  {
    const cases = [
      ['err403', 'auth'],
      ['errhtml', 'auth'],
      ['err500', 'generic'],
      ['errbig', 'size'],
    ];
    const site = await newPage();
    await allowDownloads(site);
    await site.goto(`${SITE}/site.html`, { waitUntil: 'load' });
    for (const [linkId, kind] of cases) {
      hits.length = 0;
      await jsClick(site, `#${linkId}`);
      await sleep(2500);
      const vt = await viewerTabs();
      const vp = await (async () => {
        const t = browser.targets().filter((x) => x.type() === 'page' && x.url().includes('viewer.html')).pop();
        return t ? t.page() : null;
      })();
      let card = null;
      if (vp) {
        await waitViewerSettled(vp).catch(() => {});
        card = await vp.evaluate(() => ({
          state: document.body.dataset.state,
          title: document.getElementById('errTitle')?.textContent,
          why: document.getElementById('errWhy')?.textContent,
          next: document.getElementById('errNext')?.textContent,
          downloadBtn: !document.getElementById('errDownloadBtn').hidden,
          tryBtn: !document.getElementById('errTryAgain').hidden,
        }));
        // Try again → one more request for the same URL
        const beforeHits = hits.length;
        await jsClick(vp, '#errTryAgain').catch(() => {});
        await sleep(2500);
        const retried = hits.length - beforeHits;
        // Download instead → native download
        fs.rmSync(DL, { recursive: true, force: true });
        fs.mkdirSync(DL, { recursive: true });
        const dlBtnVisible = await vp.evaluate(() => !document.getElementById('errDownloadBtn').hidden);
        if (dlBtnVisible) {
          await jsClick(vp, '#errDownloadBtn').catch(() => {});
          await sleep(4000);
        }
        note(`case6.${linkId}`, { kind, card, retried, downloads: dlFiles() });
        await vp.close().catch(() => {});
      } else {
        note(`case6.${linkId}`, { kind, card: 'no viewer tab' });
      }
    }
    await site.close().catch(() => {});
    for (const t of await viewerTabs()) await swEval((id) => chrome.tabs.remove(id), t.id).catch(() => {});
  }

  // ---------- case 7: Download original bytes + one request ----------
  {
    hits.length = 0;
    const vp = await newPage();
    await allowDownloads(vp);
    // Explicit source flow; a direct file navigation stays native in 1.0.1.
    await vp.goto(`chrome-extension://${extId}/src/viewer/viewer.html#src=${encodeURIComponent(`${SITE}/files/orig.dwg?via=case7`)}`, { waitUntil: 'load' });
    await waitViewerSettled(vp).catch(() => {});
    const meta = await vp.evaluate(() => ({
      state: document.body.dataset.state,
      srcName: document.querySelector('#srcPath b')?.textContent,
      path: document.getElementById('srcPath')?.textContent.slice(0, 80),
    }));
    fs.rmSync(DL, { recursive: true, force: true });
    fs.mkdirSync(DL, { recursive: true });
    await jsClick(vp, '#downloadBtn').catch(() => {});
    await sleep(4000);
    const files = dlFiles();
    const gotSha = files.length === 1 ? createHash('sha256').update(fs.readFileSync(path.join(DL, files[0]))).digest('hex') : null;
    note('case7.downloadOriginal', {
      meta,
      downloaded: files[0] ?? null,
      shaMatch: gotSha === sha,
      fileRequests: hits.filter((h) => h.includes('orig.dwg')).length,
      origHits: hits.filter((h) => h.includes('orig.dwg')),
    });
    await vp.close().catch(() => {});
    for (const t of await viewerTabs()) await swEval((id) => chrome.tabs.remove(id), t.id).catch(() => {});
  }

  // ---------- case 8: rating widget ----------
  {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const seed = async () =>
      swEval(async (day) => {
        await chrome.storage.local.set({
          review: { version: 1, usefulDays: 5, lastUsefulDay: day, answered: false, dismissals: 0, snoozeUntil: 0 },
          hintSeen: true,
        });
        return true;
      }, yesterday);
    const vp = await newPage();
    await seed();
    await vp.goto(`chrome-extension://${extId}/src/viewer/viewer.html`, { waitUntil: 'load' });
    // ТЗ 10.2 case 8: a fully drawn fixture — sample_AC1015 keeps two 3DSOLID
    // undrawn and the widget must stay hidden there.
    const input = path.relative(ROOT, FULLY_DRAWN);
    await vp.evaluate(async (rel) => {
      const url = chrome.runtime.getURL(rel);
      const buf = await (await fetch(url)).arrayBuffer();
      const file = new File([buf], rel.split('/').pop());
      const dt = new DataTransfer();
      dt.items.add(file);
      const inp = document.getElementById('fileInput');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, input);
    await waitViewerSettled(vp, 60000).catch(() => {});
    note('case8.opened', await vp.evaluate(() => ({ state: document.body.dataset.state, drawn: document.getElementById('drawnPill').textContent })));
    // hidden while the count has not settled into a fully drawn state
    await sleep(2500);
    note('case8.earlyHidden', await vp.evaluate(() => document.getElementById('rate').hidden));
    // wait past the 60 s rule (real wait, no test flags)
    await sleep(62000);
    const vis = await vp.evaluate(() => ({
      visible: !document.getElementById('rate').hidden,
      stars: document.querySelectorAll('#rateStars .star').length,
      lit: document.querySelectorAll('#rateStars .star.lit').length,
      aria: document.querySelector('#rateStars .star:nth-child(4)')?.getAttribute('aria-label'),
      notNow: !document.getElementById('rateNotNow').hidden,
    }));
    const beforeTabs = (await tabs()).length;
    await jsClick(vp, '#rateStars .star:nth-child(4)');
    await sleep(2500);
    const ts4 = await tabs();
    note('case8.star4', {
      visible: vis,
      storeTab: ts4.find((t) => t.url.includes('chromewebstore.google.com/detail/'))?.url.slice(0, 90) ?? null,
      answered: await swEval(() => chrome.storage.local.get('review').then((v) => v.review.answered)),
      widgetGone: await vp.evaluate(() => document.getElementById('rate').hidden),
    });
    // reset, then a 2-star click → feedback page
    await seed();
    for (const t of ts4) {
      if (t.url.includes('chromewebstore') || t.url.includes('viewer.html')) await swEval((id) => chrome.tabs.remove(id), t.id).catch(() => {});
    }
    const vp2 = await newPage();
    await vp2.goto(`chrome-extension://${extId}/src/viewer/viewer.html`, { waitUntil: 'load' });
    await vp2.evaluate(async (rel) => {
      const url = chrome.runtime.getURL(rel);
      const buf = await (await fetch(url)).arrayBuffer();
      const file = new File([buf], rel.split('/').pop());
      const dt = new DataTransfer();
      dt.items.add(file);
      const inp = document.getElementById('fileInput');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, input);
    await waitViewerSettled(vp2, 60000).catch(() => {});
    await sleep(62000);
    await jsClick(vp2, '#rateStars .star:nth-child(2)');
    await sleep(2500);
    const ts2b = await tabs();
    note('case8.star2', {
      feedbackTab: ts2b.find((t) => t.url.includes('dwg-viewer-pages/feedback'))?.url.slice(0, 90) ?? null,
      answered: await swEval(() => chrome.storage.local.get('review').then((v) => v.review.answered)),
    });
    await vp.close().catch(() => {});
    await vp2.close().catch(() => {});
    try {
      for (const t of await viewerTabs()) await swEval((id) => chrome.tabs.remove(id), t.id);
    } catch (e) {
      note('case8.cleanup', { err: String(e?.message ?? e).slice(0, 120) });
    }
  }

  // ---------- case 10: lifecycle ----------
  try {
    const welcomeUrl = await swEval(() => (chrome.runtime.getManifest(), null)).then(() => null);
    const ts = await tabs();
    const welcome = ts.filter((t) => t.url.includes('dwg-viewer-pages/welcome')).length;
    const uninstall = await swEval(() => chrome.runtime.getUninstallURL?.() ?? null);
    // reload the extension → no new welcome tab
    await swEval(() => chrome.runtime.reload());
    await sleep(4000);
    const ts2 = await tabs();
    note('case10.lifecycle', {
      welcomeOnInstall: welcome,
      welcomeAfterReload: ts2.filter((t) => t.url.includes('dwg-viewer-pages/welcome')).length,
      uninstallUrl: typeof uninstall === 'string' && uninstall.includes('/uninstall/'),
      tabsTotal: ts2.length,
    });
  } catch (e) {
    note('case10.lifecycle', { err: String(e?.message ?? e).slice(0, 160) });
  }

  console.log('E23-DONE ' + JSON.stringify(Object.keys(results)));
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'e23.json'), JSON.stringify(results, null, 2));
  process.exit(0);
} catch (err) {
  console.error('E23-FATAL ' + String(err?.stack ?? err).slice(0, 1200));
  fs.writeFileSync(path.join(OUT, 'e23.json'), JSON.stringify(results, null, 2));
  await browser.close().catch(() => {});
  server.close();
  process.exit(1);
}
