// Viewer tab logic (ТЗ 7.4): start → loading → view/error, open from disk or
// link (#src=), progress card, honest drawn/total counter, partial
// notice, layers panel, background switch, print sheet, settings popover,
// link notice, rating widget (F-8…F-27).
import * as engine from './engine.js';
import { OPEN_TIME_LIMIT_S, LINK_LIMIT_MB, REVIEW_MIN_SECONDS } from '../lib/config.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { isDrawingUrl } from '../lib/links-match.js';
import {
  REVIEW_DEFAULTS,
  migrateReview,
  recordUsefulDay,
  shouldShow,
  urlForStars,
  applyStars,
  applyNotNow,
} from '../lib/review.js';
import { VERSION_CODES, SUPPORTED_RANGE } from '../lib/format.js';
import {
  LINK_LIMIT_BYTES,
  classifyLinkStatus,
  isAuthHtml,
  looksLikeHtml,
  isOverLinkLimit,
} from '../lib/link-classify.js';

const $ = (id) => document.getElementById(id);
const msg = (key, ...args) => chrome.i18n.getMessage(key, args.map(String));

const isMac = /Mac/i.test(navigator.platform ?? '');
const OLDEST_NAME = VERSION_CODES[SUPPORTED_RANGE.oldest] ?? SUPPORTED_RANGE.oldest;
const NEWEST_NAME = VERSION_CODES[SUPPORTED_RANGE.newest] ?? SUPPORTED_RANGE.newest;

const ICON_OPEN =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 2h5.4A1.5 1.5 0 0 1 14.5 6.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const ICON_ZOOM_IN =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.3"/><path d="M10.4 10.4 14 14M7 4.9v4.2M4.9 7h4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const ICON_ZOOM_OUT =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.3"/><path d="M10.4 10.4 14 14M4.9 7h4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const ICON_ERR =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3 17.5 16h-15z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v4M10 14.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_SETTINGS =
  '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M1.5 3.5h5.5M10 3.5h1.5M1.5 9.5h1.5M6 9.5h5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8.5" cy="3.5" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="4.5" cy="9.5" r="1.5" stroke="currentColor" stroke-width="1.3"/></svg>';
const ICON_STAR =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9L3.4 9.4l6-.7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

const els = {};
for (const id of [
  'fileBox', 'fname', 'fchip', 'zoomGroup', 'zoomOutBtn', 'zoomPct', 'zoomInBtn', 'fitBtn', 'openBtn',
  'layersBtn', 'layersLbl', 'bgPick', 'bgCap', 'bgDark', 'bgLight', 'printBtn', 'printLbl',
  'settingsBtn', 'settingsPop', 'settingsTitle', 'settingsToggle', 'settingsToggleLbl',
  'settingsToggleHint', 'settingsNote',
  'srcbar', 'srcLabel', 'srcPath', 'downloadBtn', 'cad', 'start', 'startDrop', 'startOr', 'openBtn2',
  'keyMod', 'keyO', 'privacyLocal', 'privacyNoUpload', 'rangeLine', 'tipLink1', 'tipLink2',
  'loading', 'loadTitle', 'loadSize', 'stepFile', 'stepFileLbl', 'stepParse', 'stepParseLbl',
  'stepDraw', 'stepDrawLbl', 'loadBar', 'loadCnt', 'cancelBtn',
  'error', 'errIco', 'errTitle', 'errWhy', 'errNext', 'errOpenAnother', 'errDownloadBtn', 'errTryAgain',
  'emptycard', 'emptyTitle',
  'stageHint', 'hintPan', 'hintZoom', 'hintFit', 'dragOver', 'dropToOpenLbl',
  'notice', 'noticeText', 'noticeSettings', 'noticeGot',
  'partial', 'partialMsg', 'partialDetailsBtn', 'partialDismissBtn', 'partialDet',
  'partialRows', 'fontNote', 'colType', 'colCount', 'colLayers',
  'layoutTabs', 'coords', 'drawnPill', 'renderedLbl', 'fileInput',
  'layersPanel', 'layersTitle', 'layersCount', 'layersShowAll', 'layersHideAll', 'layersRows',
  'rate', 'rateQuestion', 'rateStars', 'rateNotNow',
  'printSheet', 'printName', 'printLayout', 'printDate', 'printLayers', 'printObjects', 'printShot2',
  'pageStyle',
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
let settingsCache = null;
let reviewRecord = migrateReview(null);
let reviewTimer = null;
let openStartedAt = 0;
let layerRows = []; // [{name, input, label}]
let hintDone = false;

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
function fmtCoord(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
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
  clearTimeout(reviewTimer);
  engine.dispose();
  els.fileInput.value = '';
  els.loading.hidden = true;
  els.error.hidden = true;
  els.emptycard.hidden = true;
  els.partial.hidden = true;
  els.srcbar.hidden = true;
  els.drawnPill.hidden = true;
  els.rate.hidden = true;
  els.notice.hidden = true;
  els.settingsPop.hidden = true;
  els.settingsBtn.setAttribute('aria-expanded', 'false');
  els.layersRows.replaceChildren();
  layerRows = [];
  document.body.dataset.layers = 'off';
  els.layersBtn.setAttribute('aria-pressed', 'false');
  els.coords.textContent = '';
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

// F-10: the list is the undrawn object types by count; missing fonts are not
// objects (their text is drawn with the fallback font) and only get the
// font line in Details. Type codes the parser does not name (E1: "1 8C6")
// and UNDERLAY records read as words, not raw codes.
function typeName(t) {
  if (t === 'OTHER' || /^[0-9A-Fa-f]{1,4}$/.test(t)) return msg('partialUnknownTypes');
  if (/UNDERLAY$/i.test(t)) return msg('partialTypeUnderlay');
  return t;
}

function showPartial() {
  if (!current) return;
  const { counts: c, missed: m } = current;
  const groups = c.byType ?? [];
  const items = groups.map((g) => msg('partialItem', fmtInt(g.count), typeName(g.type)));
  for (const x of [...m.xrefs, ...m.images]) items.push(msg('partialItem', '1', typeName(x.name)));
  const summary = items.length ? items.join(', ') : msg('partialUnknownTypes');
  els.partialMsg.textContent = msg('partialSummary', summary);
  els.fontNote.hidden = m.fonts.length === 0;
  const rows = groups.map((g) => [typeName(g.type), g.count, g.layers.join(', ') || '—']);
  if (m.xrefs.length) rows.push([msg('partialTypeXref'), m.xrefs.length, '—']);
  if (m.images.length) rows.push([msg('partialTypeImage'), m.images.length, '—']);
  els.partialRows.replaceChildren(
    ...rows.map(([type, count, layers]) => {
      const tr = document.createElement('tr');
      const t1 = document.createElement('td');
      t1.textContent = type;
      const t2 = document.createElement('td');
      t2.textContent = fmtInt(count);
      const t3 = document.createElement('td');
      t3.textContent = layers;
      tr.append(t1, t2, t3);
      return tr;
    }),
  );
  els.partialDet.hidden = true;
  els.partialDetailsBtn.textContent = msg('partialDetails');
  els.partial.hidden = false;
}

const hasGaps = () =>
  current.counts?.undrawn > 0 || current.missed?.xrefs.length > 0 || current.missed?.images.length > 0;

function refreshCounts() {
  const c = engine.counts();
  current.counts = c;
  current.missed = engine.missedData();
  els.drawnPill.textContent = msg('statusDrawn', fmtInt(c.drawn), fmtInt(c.total));
  els.drawnPill.classList.toggle('undrawn', c.undrawn > 0);
  if (hasGaps()) showPartial();
  else els.partial.hidden = true;
  checkReview();
}

/* ---------- view ---------- */

function activeLayoutName() {
  const active = engine.activeLayoutBtrId();
  const l = engine.listLayouts().find((x) => x.btrId === active);
  return !l || l.isModel ? msg('modelTab') : l.name;
}

function updateTitle() {
  document.title = msg('statusFileTitle', current.meta.name, activeLayoutName());
}

function renderTabs() {
  const ls = engine.listLayouts().sort((a, b) => Number(b.isModel) - Number(a.isModel) || a.tabOrder - b.tabOrder);
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
        updateTitle();
        refreshCounts(); // the counter and the banner describe the tab on screen
      });
      return b;
    }),
  );
}

/* ---------- layers panel (F-9) ---------- */

const hexStr = (rgb) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;

function renderLayers() {
  const ls = engine.layersInfo();
  els.layersCount.textContent = fmtInt(ls.length);
  layerRows = ls.map((l) => {
    const label = document.createElement('label');
    label.className = 'lrow';
    if (!l.on) label.classList.add('off');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = l.on;
    box.addEventListener('change', () => {
      engine.setLayerVisible(l.name, box.checked);
      label.classList.toggle('off', !box.checked);
      l.on = box.checked;
    });
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = hexStr(l.colorHex);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = l.name;
    n.title = l.name;
    label.append(box, sw, n);
    return { name: l.name, input: box, label };
  });
  els.layersRows.replaceChildren(...layerRows.map((r) => r.label));
}

function setAllLayers(on) {
  for (const r of layerRows) {
    r.input.checked = on;
    r.label.classList.toggle('off', !on);
  }
  for (const r of layerRows) engine.setLayerVisible(r.name, on);
}

function setBackgroundUi(light) {
  engine.setBackground(light);
  document.body.dataset.cadbg = light ? 'light' : 'dark';
  els.bgDark.setAttribute('aria-pressed', String(!light));
  els.bgLight.setAttribute('aria-pressed', String(light));
}

async function chooseBackground(light) {
  setBackgroundUi(light);
  try {
    settingsCache = await saveSettings({ background: light ? 'light' : 'dark' });
  } catch {
    // storage unavailable: the choice lives until the tab closes
  }
}

/* ---------- settings popover (F-22) ---------- */

function openSettingsPop(open) {
  els.settingsPop.hidden = !open;
  els.settingsBtn.setAttribute('aria-expanded', String(open));
}

function applySettingsUi() {
  const s = settingsCache ?? { interceptLinks: true, background: 'dark', hintSeen: false };
  els.settingsToggle.setAttribute('aria-checked', String(s.interceptLinks !== false));
  const light = s.background === 'light';
  if (state === 'view') setBackgroundUi(light);
  els.bgDark.setAttribute('aria-pressed', String(!light));
  els.bgLight.setAttribute('aria-pressed', String(light));
}

function syncSettings(storageChange) {
  if (storageChange) {
    if (settingsCache && 'interceptLinks' in storageChange) {
      settingsCache.interceptLinks = storageChange.interceptLinks.newValue !== false;
    }
    if (settingsCache && 'background' in storageChange) {
      settingsCache.background = storageChange.background.newValue === 'light' ? 'light' : 'dark';
    }
  }
  applySettingsUi();
}

/* ---------- rating widget (F-27) ---------- */

function saveReview() {
  chrome.storage.local.set({ review: reviewRecord }).catch(() => {});
}

function checkReview() {
  if (state !== 'view' || !current) {
    els.rate.hidden = true;
    return;
  }
  const show = shouldShow(reviewRecord, {
    fullyDrawn: !hasGaps(),
    msSinceOpen: Date.now() - openStartedAt,
  });
  els.rate.hidden = !show;
}

function armReview() {
  clearTimeout(reviewTimer);
  const wait = Math.max(0, REVIEW_MIN_SECONDS * 1000 - (Date.now() - openStartedAt));
  reviewTimer = setTimeout(checkReview, wait + 250);
}

function buildStars() {
  els.rateStars.replaceChildren(
    ...[1, 2, 3, 4, 5].map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'star';
      b.setAttribute('aria-label', msg('rateStar', String(n)));
      b.innerHTML = ICON_STAR;
      b.addEventListener('click', () => {
        reviewRecord = applyStars(reviewRecord);
        saveReview();
        els.rate.hidden = true;
        chrome.tabs.create({ url: urlForStars(n), active: true });
      });
      const lit = (on) => {
        for (const [i, s] of [...els.rateStars.children].entries()) {
          s.classList.toggle('lit', on && i < n);
        }
      };
      b.addEventListener('mouseenter', () => lit(true));
      b.addEventListener('focus', () => lit(true));
      b.addEventListener('mouseleave', () => lit(false));
      b.addEventListener('blur', () => lit(false));
      return b;
    }),
  );
  // F-27 accessibility: arrow keys move focus across the star group.
  els.rateStars.addEventListener('keydown', (e) => {
    const kids = [...els.rateStars.children];
    const at = kids.indexOf(document.activeElement);
    if (at === -1) return;
    if (e.key === 'ArrowRight' && kids[at + 1]) kids[at + 1].focus();
    if (e.key === 'ArrowLeft' && kids[at - 1]) kids[at - 1].focus();
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') e.preventDefault();
  });
}

/* ---------- print sheet (F-15) ---------- */

function buildPrintSheet() {
  if (state !== 'view' || !current) return;
  els.printName.textContent = current.meta.name;
  els.printLayout.textContent = activeLayoutName();
  els.printDate.textContent = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date());
  const layers = engine.layersInfo();
  els.printLayers.textContent = msg('printLayersOn', fmtInt(layers.filter((l) => l.on).length), fmtInt(layers.length));
  const c = current.counts ?? engine.counts();
  els.printObjects.textContent = msg('statusDrawn', fmtInt(c.drawn), fmtInt(c.total));
  // Native Print blocks image decoding until afterprint on macOS. Copy pixels
  // synchronously instead, so button, keyboard and browser-menu print agree.
  const canvas = engine.printCanvas();
  els.printShot2.width = canvas?.width ?? 0;
  els.printShot2.height = canvas?.height ?? 0;
  if (canvas) els.printShot2.getContext('2d').drawImage(canvas, 0, 0);
  const live = document.querySelector('#cad canvas');
  const landscape = (live?.clientWidth || 1) >= (live?.clientHeight || 1);
  els.pageStyle.textContent = `@page { margin: 0; size: A4 ${landscape ? 'landscape' : 'portrait'}; }`;
}

window.addEventListener('beforeprint', buildPrintSheet);
window.addEventListener('afterprint', () => {
  els.printShot2.width = 0;
  els.printShot2.height = 0;
});

function enterView() {
  setState('view');
  els.loading.hidden = true;
  const { meta, ver } = current;
  updateTitle();
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
  // Background choice applies to every drawing (settings.background).
  setBackgroundUi(settingsCache?.background === 'light');
  renderLayers();
  // A drawing that reached the view without an error card counts as a
  // useful day (F-27), and the empty-drawing card replaces a blank canvas.
  reviewRecord = recordUsefulDay(reviewRecord);
  saveReview();
  armReview();
  maybeShowNotice();
  maybeShowEmptyCard();
  maybeShowHint();
}

/* ---------- empty-drawing card (accepted at the E1 review) ---------- */

// block.dxf / PolyLine2D.dxf: 0 of 0 objects; condominium.dwg: only 3DSOLID
// solids the viewer does not draw. Both read as a blank screen without it.
function maybeShowEmptyCard() {
  const c = current?.counts;
  if (!c) {
    els.emptycard.hidden = true;
    return;
  }
  // condominium.dwg: 52 of 65 objects are 3DSOLID solids the viewer does not
  // draw, the 13 drawn ones are corner fragments — the canvas reads as blank,
  // so the card names it a 3D model. A file with nothing drawable at all
  // (block.dxf: 0 of 0) gets the no-objects card instead.
  const solids = (c.byType ?? []).find((g) => /3DSOLID/i.test(g.type))?.count ?? 0;
  const is3d = c.total > 0 && solids >= c.total / 2 && solids >= c.undrawn / 2;
  if (!is3d && c.drawn > 0) {
    els.emptycard.hidden = true;
    return;
  }
  els.emptyTitle.textContent = msg(is3d ? 'empty3dModel' : 'emptyNoObjects');
  els.emptycard.hidden = false;
}

/* ---------- first-intercept notice (F-23) ---------- */

function maybeShowNotice() {
  if (!current?.meta.url || settingsCache?.linkNoticeSeen) return;
  els.notice.hidden = false;
}

async function dismissNotice(openSettings) {
  els.notice.hidden = true;
  try {
    settingsCache = await saveSettings({ linkNoticeSeen: true });
  } catch {
    // without storage the notice would reappear next time; acceptable
  }
  if (openSettings) openSettingsPop(true);
}

/* ---------- first-open hint (F-8) ---------- */

function maybeShowHint() {
  hintDone = settingsCache?.hintSeen === true;
  els.stageHint.hidden = state !== 'view' || hintDone;
}

function dismissHint() {
  if (hintDone) return;
  hintDone = true;
  els.stageHint.hidden = true;
  saveSettings({ hintSeen: true }).then((s) => {
    settingsCache = s;
  }).catch(() => {});
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

// The drawn count keeps growing for a while after the engine reports idle
// (late conversions of the active layout); fitting before it settles opened
// example_r14 to partial extents (E1, item 13). Wait for two equal reads.
async function settleCounts(token) {
  let last = -1;
  for (let i = 0; i < 20; i++) {
    if (token !== openToken) return;
    await new Promise((r) => setTimeout(r, 250));
    const c = engine.counts();
    if (c.drawn === last) return;
    last = c.drawn;
  }
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
  await settleCounts(token);
  if (token !== openToken) return;
  // ТЗ 10.2 case 9: drawings open on Model; the file's saved-active layout
  // stays one tab click away.
  const model = engine.listLayouts().find((l) => l.isModel);
  if (model && engine.activeLayoutBtrId() !== model.btrId) engine.showLayout(model.btrId, { fit: false });
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
  openStartedAt = Date.now();
  setState('loading');
  runOpen(token, meta, async () => new Uint8Array(await file.arrayBuffer()));
}

/* ---------- link source (#src=) ---------- */

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
  const statusKind = classifyLinkStatus(res.status);
  if (statusKind) fail(statusKind);
  if (isAuthHtml(res.status, res.headers.get('content-type'))) fail('auth');
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > 0 && isOverLinkLimit(len)) fail('size');

  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (isOverLinkLimit(buf.byteLength)) fail('size');
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
    if (isOverLinkLimit(total)) {
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

function openLink(url) {
  // Treat a forged/malformed hash as an empty viewer; never fetch it.
  if (!isDrawingUrl(url)) {
    setState('start');
    return;
  }
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
  openStartedAt = Date.now();
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

function showCoords(e) {
  if (state !== 'view') return;
  const r = els.cad.getBoundingClientRect();
  const w = engine.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  if (!w) return;
  const units = engine.unitsSuffix();
  els.coords.textContent = msg('coordsXY', fmtCoord(w.x), fmtCoord(w.y), units);
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
  els.printBtn.addEventListener('click', () => window.print());

  els.zoomInBtn.addEventListener('click', () => {
    engine.zoomBy(1.25);
    setZoomPct();
  });
  els.zoomOutBtn.addEventListener('click', () => {
    engine.zoomBy(0.8);
    setZoomPct();
  });
  const fitAll = async () => {
    await engine.fit();
    engine.captureZoomBaseline();
    setZoomPct();
  };
  els.fitBtn.addEventListener('click', fitAll);
  // F-8: double-click anywhere on the drawing fits it, same path as Fit.
  els.cad.addEventListener('dblclick', (e) => {
    if (e.button === 0) fitAll();
  });

  // Layers panel (F-9) and canvas background (F-11).
  els.layersBtn.addEventListener('click', () => {
    const on = document.body.dataset.layers !== 'on';
    document.body.dataset.layers = on ? 'on' : 'off';
    els.layersBtn.setAttribute('aria-pressed', String(on));
  });
  els.layersShowAll.addEventListener('click', () => setAllLayers(true));
  els.layersHideAll.addEventListener('click', () => setAllLayers(false));
  els.bgDark.addEventListener('click', () => chooseBackground(false));
  els.bgLight.addEventListener('click', () => chooseBackground(true));

  // Settings popover (F-22): one toggle, live in every open tab.
  els.settingsBtn.addEventListener('click', () => openSettingsPop(els.settingsPop.hidden));
  els.settingsToggle.addEventListener('click', async () => {
    const next = els.settingsToggle.getAttribute('aria-checked') !== 'true';
    els.settingsToggle.setAttribute('aria-checked', String(next));
    try {
      settingsCache = await saveSettings({ interceptLinks: next });
    } catch {
      // storage unavailable: the choice lives until the tab closes
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (els.settingsPop.hidden) return;
    if (e.target.closest?.('#settingsPop, #settingsBtn')) return;
    openSettingsPop(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.settingsPop.hidden) openSettingsPop(false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('interceptLinks' in changes || 'background' in changes) syncSettings(changes);
    if ('review' in changes) reviewRecord = migrateReview(changes.review.newValue);
  });

  // Link notice (F-23): both buttons dismiss it for good.
  els.noticeGot.addEventListener('click', () => dismissNotice(false));
  els.noticeSettings.addEventListener('click', () => dismissNotice(true));

  // Rating widget (F-27).
  els.rateNotNow.addEventListener('click', () => {
    reviewRecord = applyNotNow(reviewRecord);
    saveReview();
    els.rate.hidden = true;
  });

  // Cursor coordinates (F-13) + zoom percent + the hint dismissal (F-8).
  els.cad.addEventListener('mousemove', showCoords);
  els.cad.addEventListener(
    'wheel',
    () => {
      requestAnimationFrame(setZoomPct);
      dismissHint();
    },
    { passive: true },
  );
  els.cad.addEventListener('pointerdown', dismissHint);

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
    if (hasGaps()) showPartial();
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
  t('layersLbl', 'layers');
  t('layersTitle', 'layers');
  t('layersShowAll', 'showAll');
  t('layersHideAll', 'hideAll');
  t('bgCap', 'background');
  t('bgDark', 'dark');
  t('bgLight', 'light');
  t('printLbl', 'printSave');
  t('settingsTitle', 'settings');
  t('settingsToggleLbl', 'settingsToggleLbl');
  t('settingsToggleHint', 'settingsToggleHint');
  t('settingsNote', 'settingsNote');
  t('noticeText', 'noticeText');
  t('noticeSettings', 'settings');
  t('noticeGot', 'noticeGot');
  t('rateQuestion', 'rateQuestion');
  t('rateNotNow', 'rateNotNow');
  els.layersBtn.title = msg('layers');
  els.printBtn.title = msg('printSave');
  els.settingsBtn.title = msg('settings');
  els.settingsBtn.innerHTML = ICON_SETTINGS;
  buildStars();
  // CSS data-state rules drive these; the hidden attribute would win over them
  els.fileBox.hidden = false;
  els.zoomGroup.hidden = false;
  els.layersBtn.hidden = false;
  els.bgPick.hidden = false;
  els.printBtn.hidden = false;
  els.layersPanel.hidden = false; // shown by the data-layers gate

  loadSettings()
    .then((s) => {
      settingsCache = s;
      applySettingsUi();
      // with link interception off, only the right-click tip applies
      if (s.interceptLinks === false) els.tipLink1.hidden = true;
    })
    .catch(() => {});
  chrome.storage.local
    .get('review')
    .then((v) => {
      reviewRecord = migrateReview(v.review);
    })
    .catch(() => {});
}

function init() {
  localize();
  wire();
  const h = location.hash;
  // Only the encoded source-link route is supported.
  if (h.startsWith('#src=')) openLink(decodeSafe(h.slice(5)));
  else setState('start');
}

init();
