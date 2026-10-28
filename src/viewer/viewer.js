// Viewer tab logic (ТЗ 7.4): start → loading → view/error, open from disk or
// link (#src=, #raw=), progress card, honest drawn/total counter, partial
// notice. Layers/Background/Print/Settings screens are later phases.
import * as engine from './engine.js';
import { OPEN_TIME_LIMIT_S, LINK_LIMIT_MB } from '../lib/config.js';
import { loadSettings } from '../lib/settings.js';
import { VERSION_CODES, SUPPORTED_RANGE } from '../lib/format.js';

const $ = (id) => document.getElementById(id);
const msg = (key, ...args) => chrome.i18n.getMessage(key, args.map(String));

const isMac = /Mac/i.test(navigator.platform ?? '');
const OLDEST_NAME = VERSION_CODES[SUPPORTED_RANGE.oldest] ?? SUPPORTED_RANGE.oldest;
const NEWEST_NAME = VERSION_CODES[SUPPORTED_RANGE.newest] ?? SUPPORTED_RANGE.newest;
const LINK_LIMIT_BYTES = LINK_LIMIT_MB * 1e6;

const ICON_OPEN =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 2h5.4A1.5 1.5 0 0 1 14.5 6.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const ICON_ZOOM_IN =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.3"/><path d="M10.4 10.4 14 14M7 4.9v4.2M4.9 7h4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const ICON_ZOOM_OUT =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.3"/><path d="M10.4 10.4 14 14M4.9 7h4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const ICON_ERR =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3 17.5 16h-15z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v4M10 14.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

const els = {};
for (const id of [
  'fileBox', 'fname', 'fchip', 'zoomGroup', 'zoomOutBtn', 'zoomPct', 'zoomInBtn', 'fitBtn', 'openBtn',
  'srcbar', 'srcLabel', 'srcPath', 'downloadBtn', 'cad', 'start', 'startDrop', 'startOr', 'openBtn2',
  'keyMod', 'keyO', 'privacyLocal', 'privacyNoUpload', 'rangeLine', 'tipLink1', 'tipLink2',
  'loading', 'loadTitle', 'loadSize', 'stepFile', 'stepFileLbl', 'stepParse', 'stepParseLbl',
  'stepDraw', 'stepDrawLbl', 'loadBar', 'loadCnt', 'cancelBtn',
  'error', 'errIco', 'errTitle', 'errWhy', 'errNext', 'errOpenAnother', 'errDownloadBtn', 'errTryAgain',
  'hintPan', 'hintZoom', 'hintFit', 'dragOver', 'dropToOpenLbl',
  'partial', 'partialMsg', 'partialDetailsBtn', 'partialDismissBtn', 'partialDet',
  'partialRows', 'fontNote', 'layoutTabs', 'drawnPill', 'renderedLbl', 'fileInput',
]) els[id] = $(id);

let state = 'start';
// Guards every async step; any stale continuation (cancelled, superseded by a
// new open) sees a mismatched token and returns.
let openToken = 0;
let abortCtl = null;
let cardTimer = null;
let pollTimer = null;
let current = null; // { meta, ver, bytes, counts, missed } while a drawing is open
let retry = null; // link-error "Try again"
let retryUrl = null; // link-error "Download instead"

function setState(next) {
  state = next;
  document.body.dataset.state = next;
  document.body.dataset.busy = next === 'loading' ? '1' : '0';
}

function fmtBytes(n) {
  return n >= 1e6 ? msg('sizeMB', (n / 1e6).toFixed(1)) : msg('sizeKB', String(Math.max(1, Math.round(n / 1e3))));
}
function fmtInt(n) {
  return n.toLocaleString('en-US');
}
function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
const kindFromName = (n) => (/\.dxf$/i.test(n ?? '') ? 'dxf' : 'dwg');

function setStep(el, mode) {
  el.classList.toggle('done', mode === 'done');
  el.classList.toggle('now', mode === 'now');
}
function setBar(pct) {
  els.loadBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
function setZoomPct() {
  const z = engine.zoomPercent();
  els.zoomPct.textContent = z === null ? '' : `${z}%`;
  els.zoomPct.style.display = z === null ? 'none' : '';
}

/* ---------- screens ---------- */

function showCard(meta, { reading = false } = {}) {
  els.loading.hidden = false;
  els.loadTitle.textContent = msg('loadingOpening', meta.name);
  els.loadSize.textContent = meta.size != null ? fmtBytes(meta.size) : '';
  els.loadCnt.textContent = '';
  setBar(0);
  setStep(els.stepFile, reading ? 'now' : 'done');
  setStep(els.stepParse, false);
  setStep(els.stepDraw, false);
  els.stepParseLbl.textContent = msg(meta.kind === 'dxf' ? 'stageReadDxf' : 'stageReadDwg');
}

function showError({ title, why, next, download = false, retryFn = null }) {
  engine.dispose();
  setState('error');
  els.loading.hidden = true;
  els.error.hidden = false;
  els.errIco.innerHTML = ICON_ERR;
  els.errTitle.textContent = title;
  els.errWhy.textContent = why;
  els.errNext.textContent = next;
  els.errDownloadBtn.hidden = !download;
  els.errTryAgain.hidden = !retryFn;
  retry = retryFn;
}

function showStart() {
  openToken++;
  if (abortCtl) {
    abortCtl.abort();
    abortCtl = null;
  }
  clearTimeout(cardTimer);
  clearInterval(pollTimer);
  engine.dispose();
  els.fileInput.value = '';
  els.loading.hidden = true;
  els.error.hidden = true;
  els.partial.hidden = true;
  els.srcbar.hidden = true;
  els.drawnPill.hidden = true;
  current = null;
  retry = null;
  retryUrl = null;
  document.title = 'DWG Viewer';
  setState('start');
}

function cancelOpen() {
  showStart();
}

/* ---------- partial notice + status bar ---------- */

function showPartial() {
  if (!current) return;
  const { counts: c, missed: m } = current;
  const items = [];
  for (const x of [...m.xrefs, ...m.images, ...m.fonts]) {
    items.push(msg('partialItem', String(x.count), x.name));
  }
  const summary = items.length ? items.join(', ') : msg('partialUnknownTypes');
  els.partialMsg.textContent = msg('partialSummary', summary);
  els.fontNote.hidden = m.fonts.length === 0;
  const total = (arr) => arr.reduce((s, x) => s + x.count, 0);
  const rows = [];
  if (m.xrefs.length) rows.push([msg('partialTypeXref'), total(m.xrefs)]);
  if (m.images.length) rows.push([msg('partialTypeImage'), total(m.images)]);
  if (m.fonts.length) rows.push([msg('partialTypeFont'), total(m.fonts)]);
  els.partialRows.replaceChildren(
    ...rows.map(([type, count]) => {
      const tr = document.createElement('tr');
      const t1 = document.createElement('td');
      t1.textContent = type;
      const t2 = document.createElement('td');
      t2.textContent = fmtInt(count);
      const t3 = document.createElement('td');
      t3.textContent = '—';
      tr.append(t1, t2, t3);
      return tr;
    }),
  );
  els.partialDet.hidden = true;
  els.partialDetailsBtn.textContent = msg('partialDetails');
  els.partial.hidden = false;
}

function refreshCounts() {
  const c = engine.counts();
  current.counts = c;
  current.missed = engine.missedData();
  els.drawnPill.textContent = msg('statusDrawn', fmtInt(c.drawn), fmtInt(c.total));
  els.drawnPill.classList.toggle('undrawn', c.undrawn > 0);
  if (c.undrawn > 0 || !current.missed.empty) showPartial();
  else els.partial.hidden = true;
}

/* ---------- view ---------- */

function renderTabs() {
  const ls = engine.listLayouts().sort((a, b) => Number(b.isModel) - Number(a.isModel));
  const active = engine.activeLayoutBtrId();
  els.layoutTabs.hidden = ls.length < 2;
  els.layoutTabs.replaceChildren(
    ...ls.map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stab';
      b.setAttribute('role', 'tab');
      b.textContent = l.isModel ? msg('modelTab') : l.name;
      b.setAttribute('aria-selected', String(l.btrId === active));
      b.addEventListener('click', async () => {
        if (l.btrId === engine.activeLayoutBtrId()) return;
        engine.showLayout(l.btrId, { fit: false });
        await engine.fit();
        engine.captureZoomBaseline();
        setZoomPct();
        for (const t of els.layoutTabs.children) {
          t.setAttribute('aria-selected', String(t === b));
        }
      });
      return b;
    }),
  );
}

function enterView() {
  setState('view');
  els.loading.hidden = true;
  const { meta, ver } = current;
  document.title = msg('statusFileTitle', meta.name);
  els.fname.textContent = meta.name;
  if (ver.kind === 'dwg') els.fchip.textContent = msg('chipDwg', ver.name);
  else if (ver.code) els.fchip.textContent = msg('chipDxf', ver.name);
  else els.fchip.textContent = msg('chipDxfPlain');
  els.fchip.hidden = false;
  els.drawnPill.hidden = false;
  if (meta.url) {
    els.srcbar.hidden = false;
    const host = document.createElement('b');
    host.textContent = meta.host;
    els.srcPath.replaceChildren(host, document.createTextNode(` / ${decodeSafe(meta.path)}`));
  }
  renderTabs();
  refreshCounts();
}

/* ---------- open: shared pipeline ---------- */

// Engine progress → card steps. FETCH_FILE never fires for local files; the
// converter emits CONVERSION subStages while parsing.
function progress(a) {
  if (els.loading.hidden) return;
  const pct = typeof a?.percentage === 'number' ? a.percentage : null;
  if (a?.stage === 'FETCH_FILE') {
    setStep(els.stepFile, 'now');
    if (pct != null) setBar(pct);
  } else if (a?.stage === 'CONVERSION') {
    setStep(els.stepFile, 'done');
    setStep(els.stepParse, a.subStageStatus === 'END' ? 'done' : 'now');
    if (pct != null) setBar(pct);
  }
}

function cantRead(meta, { download = Boolean(meta.url) } = {}) {
  showError({
    title: msg('errCantReadTitle'),
    why: msg('errCantReadBody', meta.name),
    next: msg('errCantReadHint'),
    download,
    retryFn: meta.url ? () => openLink(meta.url) : null,
  });
}

function versionError(meta, ver) {
  const known = Boolean(VERSION_CODES[ver.code]);
  showError({
    title: msg('errVersionTitle'),
    why: known
      ? msg('errVersionKnownBody', meta.name, ver.name, ver.code, OLDEST_NAME, NEWEST_NAME)
      : msg('errVersionUnknownBody', meta.name, ver.code, OLDEST_NAME, NEWEST_NAME),
    next: msg('errVersionHint'),
    download: Boolean(meta.url),
  });
}

function tooLarge(meta) {
  showError({
    title: msg('errTooLargeTitle'),
    why: msg('errTooLargeBody', meta.name, fmtBytes(meta.size ?? 0), String(OPEN_TIME_LIMIT_S)),
    next: msg('errTooLargeHint'),
    download: Boolean(meta.url),
  });
}

function linkError(kind, meta) {
  retryUrl = meta.url;
  if (kind === 'size') {
    showError({
      title: msg('errLinkTitle'),
      why: msg('errLinkSizeBody', meta.name, msg('errLinkOver', String(LINK_LIMIT_MB)), `${LINK_LIMIT_MB} MB`),
      next: msg('errLinkHint'),
      download: true,
      retryFn: () => openLink(meta.url),
    });
    return;
  }
  showError({
    title: msg('errLinkTitle'),
    why: msg('errLinkAuthBody', meta.host || meta.url, meta.name),
    next: kind === 'auth' ? `${msg('errLinkAuthWhy')} ${msg('errLinkHint')}` : msg('errLinkHint'),
    download: true,
    retryFn: () => openLink(meta.url),
  });
}

async function finishDrawing(token, deadline) {
  pollTimer = setInterval(() => {
    if (token !== openToken) {
      clearInterval(pollTimer);
      return;
    }
    try {
      const c = engine.counts();
      if (c.total > 0) {
        setBar((100 * c.drawn) / c.total);
        els.loadCnt.textContent = msg('progressObjects', fmtInt(c.drawn), fmtInt(c.total));
      }
    } catch {
      // document torn down by a concurrent cancel; token guard exits next tick
    }
  }, 250);

  let ok = deadline - Date.now() > 0;
  if (ok) {
    try {
      await engine.idle(deadline - Date.now());
    } catch {
      ok = false;
    }
    if (Date.now() > deadline) ok = false;
  }
  clearInterval(pollTimer);
  if (token !== openToken) return;
  if (!ok) {
    tooLarge(current.meta);
    return;
  }
  await engine.fit();
  if (token !== openToken) return;
  engine.captureZoomBaseline();
  setZoomPct();
  enterView();
}

// One pipeline for both sources: getBytes() resolves to Uint8Array (link
// fetches throw .linkKind = 'auth' | 'size' | 'generic' for the card 4 paths).
async function runOpen(token, meta, getBytes) {
  let bytes;
  try {
    bytes = await getBytes();
  } catch (err) {
    if (token !== openToken || err?.name === 'AbortError') return;
    if (err?.linkKind) linkError(err.linkKind, meta);
    else if (meta.url) linkError('generic', meta);
    else cantRead(meta);
    return;
  }
  if (token !== openToken) return;
  meta.size = bytes.length;

  const ver = engine.fileVersion(meta.name, bytes);
  if (!ver.kind) {
    cantRead(meta);
    return;
  }
  if (ver.kind === 'dwg' && ver.code && ver.supported === false) {
    versionError(meta, ver);
    return;
  }

  current = { meta: { ...meta, kind: ver.kind }, ver, bytes, counts: null, missed: null };
  try {
    engine.ensureEngine(els.cad);
  } catch {
    cantRead(meta);
    return;
  }

  const deadline = Date.now() + OPEN_TIME_LIMIT_S * 1000;
  const res = await engine.open({ name: meta.name, bytes, onProgress: (a) => progress(a) });
  if (token !== openToken) return;
  clearTimeout(cardTimer);
  if (!res.ok) {
    if (res.reason === 'timeout') tooLarge(current.meta);
    else if (res.reason === 'version') versionError(current.meta, res.version ?? ver);
    else cantRead(current.meta);
    return;
  }

  if (els.loading.hidden) showCard(current.meta);
  setStep(els.stepFile, 'done');
  setStep(els.stepParse, 'done');
  setStep(els.stepDraw, 'now');
  await finishDrawing(token, deadline);
}

function openLocalFile(file) {
  const token = ++openToken;
  abortCtl = null;
  clearTimeout(cardTimer);
  clearInterval(pollTimer);
  els.fileInput.value = '';
  const meta = { name: file.name, size: file.size, kind: kindFromName(file.name) };
  cardTimer = setTimeout(() => {
    if (token === openToken) showCard(meta);
  }, 500);
  setState('loading');
  runOpen(token, meta, async () => new Uint8Array(await file.arrayBuffer()));
}

/* ---------- link source (#src= / #raw=) ---------- */

// ТЗ 7.5: cookies are sent (sites behind a login), HTML responses mean a sign
// -in page, and oversized streams are cut off as soon as the cap is crossed.
async function fetchLink(token, url) {
  const fail = (kind) => {
    const e = new Error(`link:${kind}`);
    e.linkKind = kind;
    throw e;
  };
  let res;
  try {
    res = await fetch(url, { credentials: 'include', redirect: 'follow', signal: abortCtl.signal });
  } catch (err) {
    if (token !== openToken || err?.name === 'AbortError') {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  }
  if (token !== openToken) {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  }
  if (!res.ok) fail(res.status === 401 || res.status === 403 ? 'auth' : 'generic');
  if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) fail('auth');
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > 0 && len > LINK_LIMIT_BYTES) fail('size');

  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > LINK_LIMIT_BYTES) fail('size');
    const out = new Uint8Array(buf);
    if (looksLikeHtml(out)) fail('auth');
    return out;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    let r;
    try {
      r = await reader.read();
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      fail('generic');
    }
    if (r.done) break;
    total += r.value.byteLength;
    if (total > LINK_LIMIT_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // best effort — the connection dies with the tab anyway
      }
      fail('size');
    }
    chunks.push(r.value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    out.set(ch, off);
    off += ch.byteLength;
  }
  if (looksLikeHtml(out)) fail('auth');
  return out;
}

function looksLikeHtml(bytes) {
  const head = new TextDecoder('ascii', { fatal: false })
    .decode(bytes.subarray(0, 64))
    .trimStart()
    .toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

function openLink(url) {
  let u = null;
  try {
    u = new URL(url);
  } catch {
    // not a URL — treat like an unreachable link
  }
  const name = u ? decodeSafe(u.pathname.split('/').pop() || '') || 'drawing' : 'drawing';
  const meta = {
    name,
    url,
    host: u?.host ?? '',
    path: u?.pathname ?? '',
    kind: kindFromName(name),
  };
  const token = ++openToken;
  abortCtl = new AbortController();
  clearTimeout(cardTimer);
  clearInterval(pollTimer);
  retryUrl = url;
  cardTimer = setTimeout(() => {
    if (token === openToken) showCard(meta, { reading: true });
  }, 500);
  setState('loading');
  runOpen(token, meta, () => fetchLink(token, url));
}

/* ---------- actions ---------- */

function downloadBytes() {
  if (!current?.bytes) return;
  const blob = new Blob([current.bytes], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = current.meta.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

function wire() {
  els.openBtn.addEventListener('click', () => els.fileInput.click());
  els.openBtn2.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    if (file) openLocalFile(file);
  });
  els.cancelBtn.addEventListener('click', cancelOpen);
  els.errOpenAnother.addEventListener('click', () => {
    showStart();
    els.fileInput.click();
  });
  els.errDownloadBtn.addEventListener('click', () => {
    if (retryUrl) chrome.runtime.sendMessage({ type: 'download-instead', url: retryUrl });
  });
  els.errTryAgain.addEventListener('click', () => retry?.());
  els.downloadBtn.addEventListener('click', downloadBytes);

  els.zoomInBtn.addEventListener('click', () => {
    engine.zoomBy(1.25);
    setZoomPct();
  });
  els.zoomOutBtn.addEventListener('click', () => {
    engine.zoomBy(0.8);
    setZoomPct();
  });
  els.fitBtn.addEventListener('click', async () => {
    await engine.fit();
    engine.captureZoomBaseline();
    setZoomPct();
  });

  els.partialDismissBtn.addEventListener('click', () => {
    els.partial.hidden = true;
  });
  els.partialDetailsBtn.addEventListener('click', () => {
    const show = els.partialDet.hidden;
    els.partialDet.hidden = !show;
    els.partialDetailsBtn.textContent = msg(show ? 'partialHideDetails' : 'partialDetails');
  });
  els.drawnPill.addEventListener('click', () => {
    if (state !== 'view' || !current) return;
    if (current.counts?.undrawn > 0 || !current.missed?.empty) showPartial();
  });

  // Ctrl+O / ⌘O — 4.2.11 verifies Chrome lets the page see it before its own
  // dialog; if not, the start-screen hint is removed instead.
  window.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && `${e.key}`.toLowerCase() === 'o') {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  // focus-open: the toolbar icon was clicked while this viewer tab is open
  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === 'focus-open') els.fileInput.click();
  });

  let dragDepth = 0;
  const dragTypes = (e) => [...(e.dataTransfer?.types ?? [])];
  window.addEventListener('dragenter', (e) => {
    if (!dragTypes(e).includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    els.dragOver.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!dragTypes(e).includes('Files')) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.dragOver.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.dragOver.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) openLocalFile(file);
  });
}

function localize() {
  const t = (id, key, ...args) => {
    els[id].textContent = msg(key, ...args);
  };
  t('startDrop', 'startDrop');
  t('startOr', 'startOr');
  t('openBtn2', 'openFile');
  els.keyMod.textContent = msg(isMac ? 'hintMacCtrl' : 'hintCtrl');
  els.keyO.textContent = msg('hintO');
  t('privacyLocal', 'privacyLocal');
  t('privacyNoUpload', 'privacyNoUpload');
  els.rangeLine.textContent = msg('rangeLine', OLDEST_NAME, NEWEST_NAME);
  t('tipLink1', 'tipLink1');
  t('tipLink2', 'tipLink2');
  els.openBtn.title = msg('openFile');
  els.openBtn.innerHTML = ICON_OPEN;
  els.zoomOutBtn.title = msg('zoomOut');
  els.zoomOutBtn.innerHTML = ICON_ZOOM_OUT;
  els.zoomInBtn.title = msg('zoomIn');
  els.zoomInBtn.innerHTML = ICON_ZOOM_IN;
  t('fitBtn', 'fit');
  t('cancelBtn', 'cancel');
  t('stepFileLbl', 'stageRead');
  t('stepDrawLbl', 'stageDraw');
  t('errOpenAnother', 'errOpenAnother');
  t('errDownloadBtn', 'errLinkDownload');
  t('errTryAgain', 'errTryAgain');
  t('hintPan', 'hintPan');
  t('hintZoom', 'hintZoom');
  t('hintFit', 'hintFit');
  t('dropToOpenLbl', 'dropToOpen');
  t('srcLabel', 'srcOpenedFrom');
  t('downloadBtn', 'srcDownload');
  t('partialDetailsBtn', 'partialDetails');
  t('partialDismissBtn', 'partialDismiss');
  t('colType', 'colType');
  t('colCount', 'colCount');
  t('colLayers', 'colLayers');
  t('renderedLbl', 'statusRendered');
  // CSS data-state rules drive these; the hidden attribute would win over them
  els.fileBox.hidden = false;
  els.zoomGroup.hidden = false;

  loadSettings()
    .then((s) => {
      // with link interception off, only the right-click tip applies
      if (s.interceptLinks === false) els.tipLink1.hidden = true;
    })
    .catch(() => {});
}

function init() {
  localize();
  wire();
  const h = location.hash;
  // #src= is written encoded by the SW; #raw= comes from the DNR redirect
  // with the URL inserted verbatim (regexSubstitution) — never decode it.
  if (h.startsWith('#src=')) openLink(decodeSafe(h.slice(5)));
  else if (h.startsWith('#raw=')) openLink(h.slice(5));
  else setState('start');
}

init();
