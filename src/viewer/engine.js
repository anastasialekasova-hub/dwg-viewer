// Thin wrapper over the vendored @mlightcad engine (ТЗ 7.3): open, fit,
// zoomBy, showLayout, dispose, plus drawn/total counters for the status bar.
// Owns the single AcApDocManager instance and the DWG converter registration.
import {
  AcApDocManager,
  AcEdOpenMode,
  AcApOpenViewMode,
  eventBus,
  AcDbLibreDwgConverter,
  AcDbDatabaseConverterManager,
  AcDbFileType,
  AcGeBox2d,
  acapGetCameraZoom,
} from '../vendor/cad-viewer.js';
import { sniffKind, dwgVersion, dxfVersion } from '../lib/format.js';
import { OPEN_TIME_LIMIT_S } from '../lib/config.js';

let manager = null;

function extUrl(p) {
  return chrome.runtime.getURL(p);
}

// baseUrl must stay on-extension: the engine defaults to an external CDN for
// fonts/templates, and the viewer must make zero network requests (4.2.6).
export function ensureEngine(container) {
  if (manager) return manager;
  AcDbDatabaseConverterManager.instance.register(
    AcDbFileType.DWG,
    new AcDbLibreDwgConverter({
      useWorker: true,
      parserWorkerUrl: extUrl('src/vendor/libredwg-worker.js'),
      timeout: OPEN_TIME_LIMIT_S * 1000,
    }),
  );
  manager = AcApDocManager.createInstance({
    container,
    autoResize: true,
    baseUrl: extUrl('src/vendor/'),
    docsBaseUrl: extUrl('src/viewer/docs/'),
    builtinOpenFileDialog: false,
    disableExport: true,
    preloadDefaultFonts: false,
    notificationCenter: { showDefaultUi: false },
    webworkerFileUrls: {
      dwgParser: extUrl('src/vendor/libredwg-worker.js'),
      mtextRender: extUrl('src/vendor/mtext-renderer-worker.js'),
    },
  });
  if (!manager) throw new Error('AcApDocManager.createInstance returned undefined');
  // The engine defaults its font catalog to an external CDN and awaits fonts
  // before drawing; a stalled CDN keeps deferred glyph jobs pending forever
  // (see AcApDocManager.installFontFileLoadTimeout comment). _fontLoader is
  // the engine's FontManager singleton — repoint it at our empty on-extension
  // catalog before any open so font requests resolve as NotFound locally
  // (4.2.6 zero network).
  manager._fontLoader.baseUrl = extUrl('src/vendor/fonts/');
  return manager;
}

function view() {
  return manager.curView;
}

export function fileVersion(name, bytes) {
  const kind = sniffKind(bytes, name);
  if (kind === 'dwg') return { kind, ...dwgVersion(bytes) };
  if (kind === 'dxf') return { kind, ...dxfVersion(bytes) };
  return { kind: null };
}

function countBlockEntities(btr) {
  let n = 0;
  for (const e of btr.newIterator()) {
    if (e) n++;
  }
  return n;
}

// total: every top-level entity in model + paper spaces (what the file holds);
// drawn: what the engine rendered (view.stats.summary.entityCount).
export function counts() {
  const doc = manager.curDocument;
  let total = 0;
  for (const btr of doc.database.tables.blockTable._recordsByName.values()) {
    if (btr && (btr.isModelSapce || btr.isPaperSapce)) total += countBlockEntities(btr);
  }
  const drawn = view().stats.summary.entityCount;
  return { total, drawn, undrawn: Math.max(0, total - drawn) };
}

export function missedData() {
  const m = view().missedData;
  const fonts = Object.entries(m.fonts).map(([name, count]) => ({ name, count }));
  const images = [...m.images.keys()].map((name) => ({ name, count: 1 }));
  const xrefs = (m.xrefs ?? []).map((x) => ({ name: x.name ?? String(x), count: 1 }));
  return {
    fonts,
    images,
    xrefs,
    empty: fonts.length === 0 && images.length === 0 && xrefs.length === 0,
  };
}

export function listLayouts() {
  const doc = manager.curDocument;
  const out = [];
  for (const btr of doc.database.tables.blockTable._recordsByName.values()) {
    if (!btr) continue;
    if (btr.isModelSapce || btr.isPaperSapce) {
      out.push({ name: btr.name, btrId: String(btr.objectId), isModel: btr.isModelSapce });
    }
  }
  return out;
}

export function activeLayoutBtrId() {
  return view().activeLayoutBtrId;
}

export function showLayout(btrId, { fit: doFit = true } = {}) {
  view().activeLayoutBtrId = btrId;
  if (doFit) fit();
}

export async function open({ name, bytes, onProgress } = {}) {
  const ver = fileVersion(name, bytes);
  if (!ver.kind) return { ok: false, reason: 'kind' };
  if (ver.kind === 'dwg' && ver.code && ver.supported === false) {
    return { ok: false, reason: 'version', version: ver };
  }

  let progressHandler = null;
  if (typeof onProgress === 'function') {
    progressHandler = (args) => onProgress(args);
    eventBus.on('open-file-progress', progressHandler);
  }

  const options = {
    mode: AcEdOpenMode.Read,
    openViewMode: AcApOpenViewMode.Extents,
    convertAllLayouts: true,
    skipSpatialIndex: true,
  };
  let timer = null;
  try {
    const opened = await Promise.race([
      manager.openDocument(name, bytes, options),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), OPEN_TIME_LIMIT_S * 1000);
      }),
    ]);
    if (opened === 'timeout') return { ok: false, reason: 'timeout', version: ver };
    if (opened !== true) return { ok: false, reason: 'error', version: ver };
    return { ok: true, version: ver };
  } catch (err) {
    return { ok: false, reason: 'error', version: ver, message: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
    if (progressHandler) eventBus.off('open-file-progress', progressHandler);
  }
}

// Zoom to the drawing extents; zoomToSmartExtents falls back to batch
// geometry when EXTMIN/EXTMAX are missing or stale.
export async function fit() {
  const v = view();
  try {
    await v.zoomToSmartExtents(OPEN_TIME_LIMIT_S * 1000);
  } catch {
    v.zoomToFitDrawing(OPEN_TIME_LIMIT_S * 1000);
  }
}

// Relative zoom around the viewport center, mirroring the engine's own
// AcApZoomCmd.applyRelativeScale (capture view box, shrink by 1/factor).
export function zoomBy(factor) {
  const v = view();
  const el = v.container ?? document.querySelector('canvas');
  const w = el?.clientWidth ?? 0;
  const h = el?.clientHeight ?? 0;
  if (w <= 0 || h <= 0) return;
  const tl = v.screenToWorld({ x: 0, y: 0 });
  const br = v.screenToWorld({ x: w, y: h });
  const cx = (tl.x + br.x) / 2;
  const cy = (tl.y + br.y) / 2;
  const halfW = Math.max(br.x - tl.x, 1e-9) / (2 * factor);
  const halfH = Math.max(br.y - tl.y, 1e-9) / (2 * factor);
  const box = new AcGeBox2d();
  box.expandByPoint({ x: cx - halfW, y: cy - halfH });
  box.expandByPoint({ x: cx + halfW, y: cy + halfH });
  v.zoomTo(box, 1);
}

// Camera zoom relative to the baseline captured right after fit; null when
// the engine cannot report it (percentage hidden in the UI).
let baseZoom = null;
export function captureZoomBaseline() {
  baseZoom = acapGetCameraZoom(view());
}
export function zoomPercent() {
  const z = acapGetCameraZoom(view());
  if (z === null || z === undefined || !baseZoom || !z) return null;
  return Math.round((baseZoom / z) * 100);
}

export async function idle(timeoutMs = OPEN_TIME_LIMIT_S * 1000) {
  return view().waitUntilIdle(timeoutMs);
}

export function isProcessing() {
  return view().isProcessingEntities;
}

export function dispose() {
  if (!manager) return;
  try {
    manager.destroy?.();
  } catch {
    // single-page viewer: nothing to recover, the tab is being torn down
  }
  manager = null;
}
