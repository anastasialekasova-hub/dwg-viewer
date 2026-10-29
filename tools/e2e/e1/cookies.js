// 4.2.8 cookies/redirects/Content-Disposition and 4.2.14 incognito.
// Local HTTPS server answers for two sites, a.test (file host with a session)
// and cdn.test (another site: redirect target / third party), mapped to
// 127.0.0.1 with --host-resolver-rules. The cert is a throwaway self-signed
// one in fixtures-local/tls (not in git); Chrome runs with
// --ignore-certificate-errors. The server logs the Cookie header of every
// file request, so "which cookies left" is measured on the receiving side.
//   node tools/e2e/e1/cookies.js <fixture.dwg> [--incognito]
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, extensionId, ensureOut, finish } from './lib.js';

const fixture = path.resolve(process.argv[2]);
const wantIncognito = process.argv.includes('--incognito');
const bytes = fs.readFileSync(fixture);
const tls = path.join(process.cwd(), 'tools', 'e2e', 'fixtures-local', 'tls');
const log = [];

const server = https.createServer(
  { key: fs.readFileSync(path.join(tls, 'test.key')), cert: fs.readFileSync(path.join(tls, 'test.crt')) },
  (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const u = new URL(req.url, `https://${req.headers.host}`);
    const entry = { host, path: u.pathname + u.search, cookie: req.headers.cookie ?? '', secFetchSite: req.headers['sec-fetch-site'] ?? '', origin: req.headers.origin ?? '' };
    if (u.pathname.endsWith('.dwg')) log.push(entry);
    if (u.pathname === '/login') {
      const p = host === 'a.test' ? 'a' : 'cdn';
      res.setHeader('Set-Cookie', [
        `${p}_lax=1; Path=/; SameSite=Lax`,
        `${p}_strict=1; Path=/; SameSite=Strict`,
        `${p}_none=1; Path=/; SameSite=None; Secure`,
        `${p}_default=1; Path=/`,
      ]);
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<p>logged in ${host}</p>`);
    }
    if (u.pathname === '/frame-login') {
      // Set from inside an iframe on a.test: a real third-party cookie.
      res.setHeader('Set-Cookie', ['tp_none=1; Path=/; SameSite=None; Secure', 'tp_lax=1; Path=/; SameSite=Lax']);
      res.setHeader('Content-Type', 'text/html');
      return res.end('<p>3p frame</p>');
    }
    if (u.pathname === '/page.html') {
      res.setHeader('Content-Type', 'text/html');
      const port = server.address().port;
      return res.end(`<!doctype html><iframe src="https://cdn.test:${port}/frame-login"></iframe>
        <p><a id="lnk" href="https://a.test:${port}/private/plan.dwg?via=click">plan.dwg</a></p>`);
    }
    if (u.pathname.startsWith('/redirect/')) {
      res.writeHead(302, { Location: `https://cdn.test:${server.address().port}/cdn/${path.basename(u.pathname)}?via=redirect` });
      return res.end();
    }
    if (u.pathname.startsWith('/private/') && !/(^|; )a_(lax|default)=1/.test(req.headers.cookie ?? '')) {
      // A session site: without its cookie it answers with a sign-in page.
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Sign in</title><form>login</form>');
    }
    if (u.pathname.endsWith('.dwg')) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="Real Name (rev 2).dwg"');
      res.setHeader('Content-Length', bytes.length);
      return res.end(bytes);
    }
    res.statusCode = 404;
    res.end('nf');
  },
);
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const A = `https://a.test:${port}`;
const CDN = `https://cdn.test:${port}`;

const browser = await launchWithExtension([
  '--host-resolver-rules=MAP a.test 127.0.0.1, MAP cdn.test 127.0.0.1',
  '--ignore-certificate-errors',
]);
const out = { port, chrome: await browser.version() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let extId = await extensionId(browser);
  const swEval = async (fn, ...args) => {
    const t = browser.targets().find((x) => x.type() === 'service_worker' && x.url().startsWith(`chrome-extension://${extId}/`));
    const w = await t.worker();
    return w.evaluate(fn, ...args);
  };

  // Sessions in the regular profile: top-level visits set first-party cookies,
  // the iframe on a.test sets cdn.test cookies as a third party.
  const p = await browser.newPage();
  await p.goto(`${A}/login`);
  await p.goto(`${CDN}/login`);
  await p.goto(`${A}/page.html`);
  await sleep(800);
  const cdp = await p.createCDPSession();
  out.cookieJar = (await cdp.send('Storage.getCookies')).cookies.map((c) => `${c.domain}:${c.name}:${c.sameSite ?? 'unset'}${c.partitionKey ? ':partitioned' : ''}`);

  // Fetches from the extension page exactly like viewer.js fetchLink.
  const viewer = await browser.newPage();
  await viewer.goto(`chrome-extension://${extId}/src/viewer/viewer.html`);
  const cases = {
    publicA: `${A}/files/public.dwg?case=publicA`,
    privateA: `${A}/private/plan.dwg?case=privateA`,
    redirectToCdn: `${A}/redirect/plan.dwg?case=redirect`,
    cdnDirect: `${CDN}/cdn/plan.dwg?case=cdnDirect`,
    realPublicRedirect: 'https://github.com/DomCR/ACadSharp/raw/master/samples/sample_AC1032.dwg',
  };
  out.fetches = await viewer.evaluate(async (cases) => {
    const r = {};
    for (const [k, url] of Object.entries(cases)) {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { credentials: 'include', redirect: 'follow' });
        const buf = await res.arrayBuffer();
        const head = String.fromCharCode(...new Uint8Array(buf.slice(0, 6)));
        r[k] = { status: res.status, redirected: res.redirected, finalUrl: res.url, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), bytes: buf.byteLength, head, ms: Math.round(performance.now() - t0) };
      } catch (e) {
        r[k] = { err: String(e).slice(0, 160) };
      }
    }
    return r;
  }, cases);

  // Product flow: the real viewer opening the session-protected link (#src=).
  const flow = await browser.newPage();
  await flow.goto(`chrome-extension://${extId}/src/viewer/viewer.html#src=${encodeURIComponent(`${A}/private/plan.dwg?case=viewerFlow`)}`);
  await flow.waitForFunction(() => !document.getElementById('drawnPill').hidden || !document.getElementById('error').hidden, { timeout: 60000 }).catch(() => {});
  out.viewerFlow = await flow.evaluate(() => ({ title: document.title, fname: document.getElementById('fname')?.textContent, ok: document.getElementById('error').hidden, err: document.getElementById('errTitle')?.textContent }));
  await flow.screenshot({ path: path.join(ensureOut('screens'), 'cookies_viewerFlow.png') });

  if (wantIncognito) {
    // Each incognito stage is bounded and logged: the first run hung for 30 min
    // with no output, so the next one must say where it stops.
    const withT = (p, ms, label) => Promise.race([p, sleep(ms).then(() => { throw new Error(`timeout ${ms} ms: ${label}`); })]);
    const stage = (k, v) => { out[k] = v; console.log('INCOG ' + k + ' ' + JSON.stringify(v).slice(0, 600)); };
    try {
    // Allow in Incognito the way the toggle on chrome://extensions does it.
    const ext = await browser.newPage();
    await ext.goto(`chrome://extensions/?id=${extId}`);
    out.incognitoGrant = await withT(ext.evaluate(async (id) => {
      try {
        await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, incognitoAccess: true });
        const info = await chrome.developerPrivate.getExtensionInfo(id);
        return { ok: true, incognitoAccess: info.incognitoAccess };
      } catch (e) {
        return { ok: false, err: String(e).slice(0, 200) };
      }
    }, extId), 20000, 'developerPrivate');
    stage('incognitoGrant', out.incognitoGrant);
    await sleep(2000);
    extId = await extensionId(browser);
    out.incognitoMode = await swEval(() => ({ allowed: null, manifestIncognito: chrome.runtime.getManifest().incognito ?? 'spanning (default)' }));
    out.incognitoMode.allowed = await withT(swEval(() => chrome.extension.isAllowedIncognitoAccess()), 15000, 'isAllowedIncognitoAccess');
    stage('incognitoMode', out.incognitoMode);
    // A real incognito window (primary off-the-record profile), opened by the SW.
    const win = await withT(swEval(async (url) => {
      const w = await chrome.windows.create({ incognito: true, url });
      return { id: w.id, incognito: w.incognito };
    }, `${A}/login`), 20000, 'windows.create incognito');
    stage('incognitoWindow', win);
    stage('targetsAfterCreate', browser.targets().map((t) => `${t.type()} ${t.url().slice(0, 80)}`));
    await sleep(1500);
    // In incognito: log in with a different cookie value, then click the link.
    const findIncog = async (pred) => {
      for (let i = 0; i < 40; i++) {
        for (const t of browser.targets()) {
          if (t.type() === 'page' && pred(t.url())) {
            const pg = await withT(t.page(), 10000, 'target.page ' + t.url().slice(0, 60)).catch((e) => { console.log('INCOG page-err ' + e.message); return null; });
            if (pg) return pg;
          }
        }
        await sleep(250);
      }
      return null;
    };
    const ip = await findIncog((u) => u.startsWith(`${A}/login`));
    stage('incognitoPageFound', Boolean(ip));
    if (ip) {
      await ip.evaluate(() => (document.cookie = 'a_incog=1; path=/; SameSite=Lax'));
      await ip.goto(`${A}/page.html`);
      await sleep(800);
      const before = await swEval(() => chrome.tabs.query({}).then((ts) => ts.map((t) => t.id)));
      await ip.click('#lnk');
      await sleep(4000);
      out.afterClick = await swEval(async (before) => {
        const ts = await chrome.tabs.query({});
        const wins = await chrome.windows.getAll();
        return {
          newTabs: ts.filter((t) => !before.includes(t.id)).map((t) => ({ url: (t.pendingUrl || t.url || '').slice(0, 160), incognito: t.incognito, windowId: t.windowId })),
          windows: wins.map((w) => ({ id: w.id, incognito: w.incognito, type: w.type })),
        };
      }, before);
      stage('afterClick', out.afterClick);
      out.incognitoSourceUrl = ip.url();
      const vt = await findIncog((u) => u.includes('/src/viewer/viewer.html#src='));
      if (vt) {
        await vt.waitForFunction(() => !document.getElementById('drawnPill').hidden || !document.getElementById('error').hidden, { timeout: 60000 }).catch(() => {});
        out.incognitoViewer = await vt.evaluate(() => ({ inIncognitoContext: chrome.extension.inIncognitoContext, ok: document.getElementById('error').hidden, title: document.title }));
        stage('incognitoViewer', out.incognitoViewer);
        await vt.screenshot({ path: path.join(ensureOut('screens'), 'cookies_incognitoViewer.png') });
      }
    }
    } catch (e) {
      stage('incognitoError', String(e?.message ?? e).slice(0, 300));
    }
  }
  out.serverLog = log;
  console.log('COOKIES ' + JSON.stringify(out));
  await browser.close();
  server.close();
  finish([out], wantIncognito ? 'cookies-incognito.json' : 'cookies.json', {});
  process.exit(0);
} catch (err) {
  console.error('COOKIES-FATAL ' + String(err?.stack ?? err).slice(0, 800));
  out.serverLog = log;
  console.log('COOKIES-PARTIAL ' + JSON.stringify(out).slice(0, 4000));
  await browser.close().catch(() => {});
  server.close();
  process.exit(1);
}
