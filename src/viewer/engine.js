// Thin wrapper over the vendored @mlightcad engine (ТЗ 7.3): open, fit,
// zoomBy, showLayout, dispose, plus drawn/total counters for the status bar.
// Owns the single AcApDocManager instance and the DWG converter registration.
import {
  AcApDocManager,
  AcApSettingManager,
  AcEdOpenMode,
  AcApOpenViewMode,
  eventBus,
  AcDbLibreDwgConverter,
  AcDbDatabaseConverterManager,
  AcDbFileType,
  AcGeBox2d,
  WebGLRenderer,
} from '../vendor/cad-viewer.js';
import { sniffKind, dwgVersion, dxfVersion } from '../lib/format.js';
import { OPEN_TIME_LIMIT_S } from '../lib/config.js';
import { LIGHT_BACKGROUND_RGB, darkenToContrast } from '../lib/colors.js';

let manager = null;
// DWG: [{handle, type, layer}] for model + paper space, as parsed (pre-conversion).
let rawEntities = null;
// DXF: entities the DXF reader skipped as unknown (no per-type detail upstream).
let dxfUnknown = 0;

/* ---------- canvas palette (F-11, F-15) ---------- */

// The dark background the file was opened with (engine default, ~#302f2c);
// Light mode swaps to the paper value and back on the next file.
let savedDarkBg = LIGHT_BACKGROUND_RGB;
// 'dark' | 'light' — current canvas palette.
let palette = 'dark';
// Materials recoloured for Light mode: material -> original hex, so switching
// back restores file colours exactly (the mapping itself is not invertible).
let lightSwapped = null;
// Persistent offscreen renderer for print (created on first print, reused;
// browsers cap WebGL contexts, so the print canvas is never disposed).
let printGL = null;

// Materials attached to the scene: cached manager materials, batch clones and
// text glyph materials all appear here; texture-bearing materials are skipped
// (their map carries the colours, the material colour is a multiplier).
function eachMaterial(fn) {
  const scene = view()?._scene?.internalScene;
  if (!scene) return;
  scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      if (m.map) continue;
      if (typeof m.color?.getHex === 'function') fn(m, m.color);
      const u = m.uniforms?.u_color;
      if (u && typeof u.value?.getHex === 'function') fn(m, u.value);
    }
  });
}

function applyPalette(light) {
  const v = view();
  if (!v) return;
  if (light === (palette === 'light')) return;
  globalThis.__dwgColorMap = light ? (rgb) => darkenToContrast(rgb) : null;
  if (light) {
    lightSwapped = new Map();
    eachMaterial((m, color) => {
      const hex = color.getHex();
      if (!lightSwapped.has(m)) lightSwapped.set(m, hex);
      color.setHex(darkenToContrast(hex));
    });
    palette = 'light';
    // Upstream flips ACI-7 foreground, wipeouts and ACI-7 layers, sets the
    // clear colour and marks dirty.
    v.backgroundColor = LIGHT_BACKGROUND_RGB;
  } else {
    palette = 'dark';
    v.backgroundColor = savedDarkBg;
    const saved = lightSwapped;
    lightSwapped = null;
    globalThis.__dwgColorMap = null;
    if (saved) eachMaterial((m, color) => {
      const hex = saved.get(m);
      if (hex != null) color.setHex(hex);
    });
  }
}

export function canvasBackground() {
  return palette;
}

export function setBackground(light) {
  applyPalette(light);
}

/** Layers of the drawing: [{name, colorHex, on}] in file order. */
export function layersInfo() {
  const doc = manager?.curDocument;
  if (!doc) return [];
  const out = [];
  const seen = new Set();
  for (const rec of doc.database.tables.layerTable._recordsByName.values()) {
    if (!rec || seen.has(rec.name)) continue;
    seen.add(rec.name);
    const color = rec.color;
    const rgb = color?.isForeground ? acapForegroundRgb() : color?.RGB;
    out.push({
      name: rec.name,
      colorHex: typeof rgb === 'number' ? rgb : 0xffffff,
      on: !rec.isOff && !rec.isFrozen,
    });
  }
  return out;
}

function acapForegroundRgb() {
  return palette === 'light' ? 0x000000 : 0xffffff;
}

// Session display state (F-9): flips the three.js layer groups, not the file.
export function setLayerVisible(name, on) {
  const scene = view()?._scene;
  if (!scene) return;
  for (const layout of scene.layouts.values()) {
    const layer = layout.layers?.get?.(name);
    if (layer) layer.visible = on;
  }
  view()._isDirty = true;
}

/** $INSUNITS of the open file as a unit suffix for the status bar (F-13). */
const INSUNITS_SUFFIX = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
export function unitsSuffix() {
  const db = manager?.curDocument?.database;
  const u = db?.insunits;
  return (typeof u === 'number' && INSUNITS_SUFFIX[u]) || '';
}

export function screenToWorld(pt) {
  try {
    return view().screenToWorld(pt);
  } catch {
    return null;
  }
}

function extUrl(p) {
  return chrome.runtime.getURL(p);
}

// baseUrl must stay on-extension: the engine defaults to an external CDN for
// fonts/templates, and the viewer must make zero network requests (4.2.6).
export function ensureEngine(container) {
  if (manager) return manager;
  const dwgConverter = new AcDbLibreDwgConverter({
    useWorker: true,
    parserWorkerUrl: extUrl('src/vendor/libredwg-worker.js'),
    timeout: OPEN_TIME_LIMIT_S * 1000,
  });
  // Keep what the parser read, before the converter drops entities it cannot
  // build (returns null) — otherwise "total" would hide them (ТЗ 7.3, 4.2.3).
  const baseParse = dwgConverter.parse;
  dwgConverter.parse = async function (data, timeout) {
    const model = await baseParse.call(this, data, timeout);
    rawEntities = collectRaw(model);
    return model;
  };
  AcDbDatabaseConverterManager.instance.register(AcDbFileType.DWG, dwgConverter);
  // The viewer has its own top bar; the engine's command line ("Type command"),
  // undo/redo/delete toolbar, ribbon and coordinate readout are editor UI that
  // the mockups do not have and that land on the printed sheet (ТЗ 4.2.13).
  // Session-only (persist: false): nothing is written to localStorage.
  AcApSettingManager.instance.apply(
    {
      isShowCommandLine: false,
      isShowToolbar: false,
      isShowShortCutToolbar: false,
      isShowRibbon: false,
      isShowCoordinate: false,
      isShowLanguageSelector: false,
      isShowStats: false,
    },
    { persist: false },
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

const isLayoutName = (n) => /^\*(model|paper)_space/i.test(n || '');

let parseInfo = null; // diagnostics: what the parser returned
function collectRaw(result) {
  // The parser worker answers { model, data }; older builds answered the model.
  const model = result?.model?.tables ? result.model : result;
  const out = [];
  parseInfo = {
    keys: Object.keys(model ?? {}).slice(0, 20),
    btr: (model?.tables?.BLOCK_RECORD?.entries ?? []).slice(0, 8).map((b) => [b.name, b.entities?.length ?? null]),
    entities: Array.isArray(model?.entities) ? model.entities.length : null,
  };
  for (const btr of model?.tables?.BLOCK_RECORD?.entries ?? []) {
    if (!isLayoutName(btr.name)) continue;
    const space = String(btr.name).toLowerCase();
    for (const e of btr.entities ?? []) out.push({ handle: String(e.handle), type: e.type, layer: e.layer || '0', space });
  }
  return out;
}

function groupUndrawn(list) {
  const by = new Map();
  for (const e of list) {
    const g = by.get(e.type) ?? { type: e.type, count: 0, layers: new Set() };
    g.count++;
    g.layers.add(e.layer);
    by.set(e.type, g);
  }
  return [...by.values()]
    .map((g) => ({ type: g.type, count: g.count, layers: [...g.layers].sort() }))
    .sort((a, b) => b.count - a.count);
}

// Counts for the layout on screen (ТЗ 4.2.1: the counter matches what is
// visible; the Model tab of PolyLine2D.dxf said "1 of 1" for a paper-space
// VIEWPORT while Model was empty).
// total: top-level entities of the active space the parser read (DWG: raw
// entities of the BLOCK_RECORD with the active layout's name; DXF: converted
// entities + the parser's unknown count, attributed to Model — the DXF parser
// reports a file-wide number only);
// drawn: converted entities of the active space found in the scene;
// undrawn: [{type, count, layers}] — entities the converter dropped, plus an
// "OTHER" bucket for converted entities the renderer did not draw (the view
// reports only a total, so those cannot be attributed to a type).
export function counts() {
  const doc = manager.curDocument;
  // drawn = converted entities found in the scene. stats.entityCount counts an
  // INSERT once per layer its block touches (sample_AC1014: 172 "drawn" of 164),
  // so it is not a per-object number. A layout not converted yet (still
  // opening) counts its converted entities as drawn (ТЗ 4.2.3).
  const v = view();
  const scene = v._scene;
  const inited = v._initializedLayouts;
  const activeId = String(v.activeLayoutBtrId);
  let active = null;
  for (const btr of doc.database.tables.blockTable._recordsByName.values()) {
    if (btr && (btr.isModelSapce || btr.isPaperSapce) && String(btr.objectId) === activeId) active = btr;
  }
  if (!active) active = doc.database.tables.blockTable.modelSpace;
  const converted = new Set();
  let drawn = 0;
  if (active) {
    const btrId = String(active.objectId);
    const lay = scene?.layouts?.get(btrId);
    const live = Boolean(lay) && (!inited || inited.has(btrId));
    for (const e of active.newIterator()) {
      if (!e) continue;
      const id = String(e.objectId);
      converted.add(id);
      if (!live || lay.hasEntity(id)) drawn++;
    }
  }
  const isModel = Boolean(active?.isModelSapce);
  const undrawnList = [];
  let total;
  if (rawEntities) {
    const name = String(active?.name ?? '').toLowerCase();
    const mine = rawEntities.filter((e) => e.space === name);
    total = mine.length;
    for (const e of mine) if (!converted.has(e.handle)) undrawnList.push(e);
  } else {
    const unknown = isModel ? dxfUnknown : 0;
    total = converted.size + unknown;
    for (let i = 0; i < unknown; i++) undrawnList.push({ type: 'UNKNOWN', layer: '?' });
  }
  const undrawnN = Math.max(0, total - drawn);
  const notRendered = undrawnN - undrawnList.length;
  for (let i = 0; i < notRendered; i++) undrawnList.push({ type: 'OTHER', layer: '?' });
  return { total, drawn, undrawn: undrawnN, byType: groupUndrawn(undrawnList), converted: converted.size, isModel, parseInfo };
}

export function missedData() {
  const m = view().missedData;
  const fonts = Object.entries(m.fonts).map(([name, count]) => ({ name, count }));
  const images = [...m.images.keys()].map((name) => ({ name, count: 1 }));
  // A '*'-name is a layout or anonymous block, never an xref: libredwg-written
  // DXFs put the block name into group 1 (xref path), and the engine's DXF
  // reader then flags *Model_Space / *Paper_SpaceN as unresolved xrefs.
  const xrefs = (m.xrefs ?? [])
    .map((x) => ({ name: String(x?.name ?? x), count: 1 }))
    .filter((x) => !x.name.startsWith('*'));
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
      // Tab name = the layout's own name ("Layout1"), not its block record
      // ("*Paper_Space0"): it is also the default PDF name (ТЗ 4.2.13).
      let lay = null;
      try {
        lay = doc.database.objects.layout.getBtrIdAt(btr.objectId);
      } catch {
        // no layout dictionary (R12 DXF): fall back to the block name
      }
      out.push({
        name: lay?.layoutName || btr.name,
        btrId: String(btr.objectId),
        isModel: btr.isModelSapce,
        tabOrder: Number.isFinite(lay?.tabOrder) ? lay.tabOrder : 999,
      });
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

  rawEntities = null;
  dxfUnknown = 0;
  const progressHandler = (args) => {
    if (args?.subStage === 'PARSE' && args?.subStageStatus === 'END' && args?.data) {
      dxfUnknown = args.data.unknownEntityCount ?? 0;
    }
    if (typeof onProgress === 'function') onProgress(args);
  };
  eventBus.on('open-file-progress', progressHandler);

  const options = {
    mode: AcEdOpenMode.Read,
    openViewMode: AcApOpenViewMode.Extents,
    convertAllLayouts: true,
    skipSpatialIndex: false,
    // AutoCAD shows no-plot layers on screen (they are only left out of
    // plots). The engine default hides them, and libredwg reads every R14
    // layer as no-plot, which left R14 drawings blank (ТЗ 4.2.1).
    drawNoPlotLayers: true,
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
    // The engine's default canvas colour for this file, captured before any
    // Light-mode swap; setBackground(false) restores exactly this value.
    try {
      savedDarkBg = view().backgroundColor ?? savedDarkBg;
    } catch {
      // keep the previous value
    }
    return { ok: true, version: ver };
  } catch (err) {
    return { ok: false, reason: 'error', version: ver, message: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
    eventBus.off('open-file-progress', progressHandler);
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

/* ---------- print (F-15) ---------- */

// Print renders the current view off screen with the light palette: a second
// WebGLRenderer on a detached canvas (ТЗ 5.2 — 2× the on-screen size, capped
// by MAX_RENDERBUFFER_SIZE), the live scene, the active layout's camera. The
// live canvas is not read at all — hidden during @media print, its drawing
// buffer was already dropped by the time beforeprint ran (E1 4.2.13).
function printAdapter(gl) {
  return {
    get autoClear() {
      return gl.autoClear;
    },
    set autoClear(v) {
      gl.autoClear = v;
    },
    getViewport(t) {
      return gl.getViewport(t);
    },
    setViewport(x, y, w, h) {
      gl.setViewport(x, y, w, h);
    },
    setScissor(x, y, w, h) {
      gl.setScissor(x, y, w, h);
    },
    setScissorTest(b) {
      gl.setScissorTest(b);
    },
    clear() {
      gl.clear();
    },
    clearDepth() {
      gl.clearDepth();
    },
    render(scene, cam) {
      gl.render(scene, cam.internalCamera ?? cam);
    },
  };
}

export function printView() {
  const v = view();
  if (!v) return '';
  const scene = v._scene;
  const lv = v._layoutViewManager?.activeLayoutView;
  const cam = lv?._camera;
  if (!scene || !cam) return '';

  const live = document.querySelector('#cad canvas');
  const cssW = live?.clientWidth || 1280;
  const cssH = live?.clientHeight || 782;
  printGL ||= new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  const maxRB = printGL.getContext().getParameter(printGL.getContext().MAX_RENDERBUFFER_SIZE) || 4096;
  const scale = Math.min(2.5, maxRB / Math.max(cssW, cssH));
  const w = Math.round(cssW * scale);
  const h = Math.round(cssH * scale);
  printGL.setPixelRatio(1);
  printGL.setSize(w, h, false);

  // Light palette on the sheet regardless of the on-screen background (F-15):
  // walk the scene materials to the mapped colours, render, walk back.
  const wasLight = palette === 'light';
  if (!wasLight) applyPalette(true);
  printGL.setClearColor(LIGHT_BACKGROUND_RGB);
  printGL.render(scene.internalScene, cam.internalCamera);
  // Paper-space layouts: model content reaches the sheet through viewport
  // views; borrow them onto the print renderer for this frame.
  const modelLayout = scene.modelSpaceLayout;
  if (!v.isModelSpaceLayout?.() && modelLayout && lv.viewportViews?.size) {
    // The layout and its viewport views hold the live renderer; lend them the
    // print one for this frame, then give it back.
    const adapter = printAdapter(printGL);
    const saved = [];
    for (const vv of lv.viewportViews) saved.push([vv, vv._renderer]);
    for (const [vv] of saved) vv._renderer = adapter;
    try {
      lv.drawViewports(modelLayout.internalObject);
    } catch {
      // a paper layout without viewport machinery still prints its sheet view
    }
    for (const [vv, rr] of saved) vv._renderer = rr;
  }
  const url = printGL.domElement.toDataURL('image/png');
  if (!wasLight) applyPalette(false);
  return url;
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
// the engine cannot report it (percentage hidden in the UI). Percent is the
// pixels-per-world-unit ratio against the baseline: camera.zoom does not move
// when the view box changes via zoomTo, so it always read 100 % (E1, item 15).
let baseScale = null;
export function captureZoomBaseline() {
  baseScale = screenScale();
}
function screenScale() {
  const v = view();
  const el = v.container ?? document.querySelector('canvas');
  const a = v.worldToScreen({ x: 0, y: 0 });
  const b = v.worldToScreen({ x: 1, y: 0 });
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const area = (el?.clientWidth || 0) * (el?.clientHeight || 0);
  return d > 0 && Number.isFinite(d) && area > 0 ? d : null;
}
export function zoomPercent() {
  const z = screenScale();
  if (z === null || !baseScale) return null;
  return Math.round((z / baseScale) * 100);
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
  // Next file starts from the engine defaults; the background choice is
  // re-applied by the viewer once the new drawing is on screen.
  palette = 'dark';
  globalThis.__dwgColorMap = null;
  lightSwapped = null;
  baseScale = null;
}
