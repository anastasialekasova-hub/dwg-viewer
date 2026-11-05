// Э1 shared harness (ТЗ 4.2): Chrome for Testing + unpacked extension from the
// repo root. Runs only on the test server via remote-test.sh (CHROME_PATH).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
export const OUT = path.join(ROOT, 'tools', 'e2e', 'out', 'e1');
export const OPEN_LIMIT_S = Number(process.env.OPEN_TIME_LIMIT_S) || 60;

export function ensureOut(sub = '') {
  const dir = sub ? path.join(OUT, sub) : OUT;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeName(s) {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

export async function launchWithExtension(extraArgs = []) {
  const args = [
    '--lang=en-US',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--enable-precise-memory-info',
    '--enable-unsafe-swiftshader',
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    ...extraArgs,
  ];
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    protocolTimeout: 90000,
    args,
  });
}

export async function extensionId(browser) {
  for (let i = 0; i < 200; i++) {
    const sw = browser
      .targets()
      .find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
    if (sw) return new URL(sw.url()).host;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('extension service worker target not found');
}

// One page per file: viewer start screen, console + request capture wired.
export async function viewerPage(browser, extId, capture) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  capture.console = [];
  capture.requests = [];
  page.on('console', (m) => {
    capture.console.push({ type: m.type(), text: m.text().slice(0, 500) });
  });
  page.on('pageerror', (e) => {
    capture.console.push({ type: 'pageerror', text: (e.stack ?? String(e)).slice(0, 1200) });
  });
  page.on('request', (r) => capture.requests.push(r.url()));
  page.on('requestfailed', (r) => capture.requests.push(`FAILED ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(`chrome-extension://${extId}/src/viewer/viewer.html`, {
    waitUntil: 'load',
    timeout: 30000,
  });
  // The welcome tab opened at install takes focus; the user looks at the viewer.
  await page.bringToFront();
  return page;
}

// Inject heap sampler + helper to import the same engine module instance the
// viewer uses (ES module cache makes it the same instance).
export async function armPage(page) {
  await page.evaluate(() => {
    window.__heap = [];
    window.__memTimer = setInterval(() => {
      const m = performance.memory;
      if (m) window.__heap.push(m.usedJSHeapSize);
    }, 150);
    window.__stopMem = () => {
      clearInterval(window.__memTimer);
      return { peak: Math.max(0, ...window.__heap), last: window.__heap.at(-1) ?? 0 };
    };
  });
}

// Same sampler, installed for future documents (explicit source-link loads).
// __openStart resets per document.
export async function armAuto(page) {
  await page.evaluateOnNewDocument(() => {
    window.__openStart = performance.now();
    window.__heap = [];
    window.__memTimer = setInterval(() => {
      const m = performance.memory;
      if (m) window.__heap.push(m.usedJSHeapSize);
    }, 150);
    window.__stopMem = () => {
      clearInterval(window.__memTimer);
      return { peak: Math.max(0, ...window.__heap), last: window.__heap.at(-1) ?? 0 };
    };
  });
}

export async function engineSnapshot(page) {
  return page.evaluate(async () => {
    const url = chrome.runtime.getURL('src/viewer/engine.js');
    const m = await import(url);
    const t = performance.now();
    let idle = null;
    try {
      idle = await m.idle(30000);
    } catch {}
    const msIdle = Math.round(performance.now() - t);
    let canvas = null;
    const host = document.getElementById('cad');
    if (host) canvas = host.querySelector('canvas');
    return {
      counts: m.counts(),
      idle,
      msIdle,
      missed: m.missedData(),
      layouts: m.listLayouts().map((l) => ({ name: l.name, isModel: l.isModel })),
      hasCanvas: Boolean(canvas),
      w: canvas?.width ?? 0,
      h: canvas?.height ?? 0,
    };
  });
}

export function cspViolations(capture) {
  return capture.console.filter(
    (c) =>
      /CSP|Content Security Policy|Refused to (load|execute|connect)/i.test(c.text) ||
      c.type === 'pageerror',
  );
}

export function externalRequests(capture) {
  return capture.requests.filter(
    (u) => {
      // requestfailed entries arrive as "FAILED <url>" — strip before the scheme filter
      const url = u.startsWith('FAILED ') ? u.slice(7) : u;
      return (
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('devtools://') &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:') &&
        !url.startsWith('about:')
      );
    },
  );
}

export function finish(rows, outfile, extra = {}) {
  ensureOut();
  const out = path.join(OUT, outfile);
  fs.writeFileSync(out, JSON.stringify({ ...extra, rows }, null, 2));
  for (const r of rows) console.log('ROW ' + JSON.stringify(r));
  console.log(`WROTE ${path.relative(ROOT, out)} rows=${rows.length}`);
}

// Visible-drawing metric (ТЗ 4.2.1 is judged by the screen, not the counter).
// Area: x 0..w, y 50..min(h-120, 785) of the 1280×900 viewport — below the
// viewer top bar, above the bottom panel. Dominant colour = the most common
// colour in the area (the background); "ink" = a pixel that differs from it by
// more than 40 on any channel. Returns the ink share and the ink bounding box
// as a share of the area on each axis.
let metricPage = null;
export async function pixelMetric(browser, png) {
  if (!metricPage || metricPage.isClosed()) {
    metricPage = await browser.newPage();
    await metricPage.goto('about:blank');
  }
  const b64 = Buffer.from(png).toString('base64');
  return metricPage.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const W = bmp.width;
    const H = bmp.height;
    const y0 = 50;
    const y1 = Math.min(H - 120, 785);
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, y0, W, y1 - y0).data;
    const hist = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    let bg = 0;
    let best = -1;
    for (const [k, v] of hist) if (v > best) { best = v; bg = k; }
    const br = bg >> 16, bgG = (bg >> 8) & 255, bb = bg & 255;
    let ink = 0, minX = W, maxX = -1, minY = H, maxY = -1;
    const rowW = W * 4;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - br) > 40 || Math.abs(d[i + 1] - bgG) > 40 || Math.abs(d[i + 2] - bb) > 40) {
        ink++;
        const x = (i % rowW) / 4;
        const y = Math.floor(i / rowW);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const areaH = y1 - y0;
    const total = W * areaH;
    return {
      sharePct: Math.round((ink / total) * 10000) / 100,
      bg: '#' + bg.toString(16).padStart(6, '0'),
      bboxW: ink ? Math.round(((maxX - minX + 1) / W) * 100) : 0,
      bboxH: ink ? Math.round(((maxY - minY + 1) / areaH) * 100) : 0,
      area: [0, y0, W, y1],
    };
  }, b64);
}

// One word for the "на экране" column. пусто: under 0.05 % ink; частично: the
// ink box spans under 30 % of the area on both axes (the fit leaves the drawing
// a speck); otherwise чертёж. Cases where a reference render shows more than the
// screen are downgraded by hand in the report.
export function screenWord(m) {
  if (!m || m.sharePct < 0.05) return 'пусто';
  if (m.bboxW < 30 && m.bboxH < 30) return 'частично';
  return 'чертёж';
}
