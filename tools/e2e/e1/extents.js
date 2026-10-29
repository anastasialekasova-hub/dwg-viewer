// Diagnostic: open one file through engine.open and list every model/paper
// space entity with its type and geometric extents, plus the drawing extents,
// to find entities whose geometry lands far from the rest (4.2.1 reference
// comparison). Writes tools/e2e/out/e1/extents-<file>.json and a screenshot.
//   node tools/e2e/e1/extents.js <file>
import fs from 'node:fs';
import path from 'node:path';
import { launchWithExtension, extensionId, viewerPage, armPage, finish, ensureOut, safeName } from './lib.js';

const fileArg = path.resolve(process.argv[2]);
const b64 = fs.readFileSync(fileArg).toString('base64');
const name = path.basename(fileArg);

const browser = await launchWithExtension();
try {
  const extId = await extensionId(browser);
  const page = await viewerPage(browser, extId, {});
  await armPage(page);
  const res = await page.evaluate(async ({ b64, name }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const m = await import(chrome.runtime.getURL('src/viewer/engine.js'));
    const cv = await import(chrome.runtime.getURL('src/vendor/cad-viewer.js'));
    m.ensureEngine(document.getElementById('cad'));
    const r = await m.open({ name, bytes, onProgress: () => {} });
    for (let i = 0; i < 120 && m.isProcessing(); i++) await new Promise((ok) => setTimeout(ok, 250));
    const db = cv.AcApDocManager.instance.curDocument.database;
    const pt = (p) => (p ? [p.x, p.y].map((v) => Math.round(v * 1000) / 1000) : null);
    const rows = [];
    for (const btr of db.tables.blockTable._recordsByName.values()) {
      if (!btr || !(btr.isModelSapce || btr.isPaperSapce)) continue;
      for (const e of btr.newIterator()) {
        if (!e) continue;
        let ext = null;
        try {
          const b = e.geometricExtents;
          ext = { min: pt(b.min), max: pt(b.max) };
        } catch (err) {
          ext = { err: String(err).slice(0, 80) };
        }
        rows.push({ space: btr.name, id: String(e.objectId), owner: String(e.ownerId), layer: e.layer, vis: e.visibility, type: e.type ?? e.dxfTypeName ?? e.constructor?.name, ext });
      }
    }
    const v = cv.AcApDocManager.instance.curView;
    const space = {
      cur: String(db.currentSpaceId), ms: String(db.tables.blockTable.modelSpace.objectId),
      active: String(v.activeLayoutBtrId), viewMs: String(v.modelSpaceBtrId), tilemode: db.tilemode,
      btrs: [...db.tables.blockTable._recordsByName.values()].filter(Boolean).map((b) => [b.name, String(b.objectId), b.isModelSapce, b.isPaperSapce]).slice(0, 12),
      layouts: [...(db.objects.layout?._recordsByName?.values?.() ?? [])].map((l) => [l.layoutName, String(l.blockTableRecordId), l.tabOrder]),
      stats: v.stats?.summary,
      layerRecs: [...db.tables.layerTable._recordsByName.values()].filter(Boolean).slice(0, 12).map((l) => ({ n: l.name, off: l.isOff, frozen: l.isFrozen, flags: l.standardFlags, color: l.color?.toString?.() })),
      sceneLayouts: [...(v._scene?.layouts?.entries?.() ?? [])].map(([k, l]) => [String(k), l?.entityCount ?? l?._entitiesMap?.size ?? null]),
    };
    const probe = [];
    for (const e of rows.slice(0, 0)) void e;
    const msb = db.tables.blockTable.modelSpace;
    let k = 0;
    for (const e of msb.newIterator()) {
      if (!e || k++ > 3) continue;
      const p = { id: String(e.objectId), type: e.type };
      try { p.should = v._entityDisplay?.shouldConvert?.(e); } catch (err) { p.shouldErr = String(err).slice(0, 200); }
      try { const d = v.drawEntity(e, false); p.drawn = d ? (d.constructor?.name ?? typeof d) : d; } catch (err) { p.drawErr = String(err?.stack ?? err).slice(0, 600); }
      probe.push(p);
    }
    space.probe = probe;
    space.cooperative = v._cooperativeYield; space.queue = v._convertQueue?.length; space.toProcess = v._numOfEntitiesToProcess; space.epoch = v._convertEpoch;
    return { space, open: r, dbExt: { min: pt(db.extmin), max: pt(db.extmax) }, counts: m.counts(), rows };
  }, { b64, name });
  for (const r of res.rows) console.log('ENT ' + JSON.stringify(r));
  console.log('SPACE ' + JSON.stringify(res.space));
  console.log('DB ' + JSON.stringify({ open: res.open, dbExt: res.dbExt, total: res.counts.total, drawn: res.counts.drawn }));
  const shot = path.join(ensureOut('screens'), `extents_${safeName(name)}.png`);
  await page.screenshot({ path: shot }).catch(() => {});
  await browser.close();
  finish([{ file: name, ...res, shot }], `extents-${safeName(name)}.json`, {});
  process.exit(0);
} catch (err) {
  console.error('EXTENTS-FATAL ' + String(err?.stack ?? err).slice(0, 600));
  await browser.close().catch(() => {});
  process.exit(1);
}
