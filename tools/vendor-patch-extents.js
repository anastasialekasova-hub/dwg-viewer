// Fit patch (ТЗ 4.2.1, F-8 "Fit — the whole drawing in the window"): the
// engine's smart fit (AcTrView2d.zoomToSmartExtents → resolveSmartFitBox)
// collects boxes from the layout spatial index, and that index also holds
// XLINE / RAY. Their render segment is ±1e6 drawing units, while the engine's
// own outlier floors (Mb size, Ib distance) start at 1e10, so the ±1e6 box is
// kept and a 1852 × 677 drawing becomes a dot in the middle of an empty
// canvas. Measured on the test server: acadsharp sample_AC1014…AC1032 (each
// has one XLINE and one RAY) opened to a blank canvas with one line.
// The engine already keeps XLINE / RAY out of its plain extents
// (layout._extentExcludedObjectIds, used by getDrawingExtents); this patch
// 1) applies the same exclusion set to the smart-fit boxes, and
// 2) drops far outliers before the engine's own clustering: when there are at
//    least 20 boxes, the core is the 2nd–98th percentile of box centres; a box
//    whose centre is more than 10 core sizes outside the core, or whose size is
//    over 100 core sizes, is not used for the fit. The boxes are still drawn.
// Applied by vendor-build.js; fails loudly if upstream drifts.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MARK = 'DWG Viewer patch: fit extents';

const HELPER = `// ${MARK}
function __dwvDropOutliers(boxes) {
  if (boxes.length < 20) return boxes;
  var xs = [], ys = [];
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    xs.push((b.minX + b.maxX) / 2);
    ys.push((b.minY + b.maxY) / 2);
  }
  xs.sort(function(a, c) { return a - c; });
  ys.sort(function(a, c) { return a - c; });
  var lo = Math.floor(xs.length * 0.02), hi = Math.min(xs.length - 1, Math.ceil(xs.length * 0.98) - 1);
  var x0 = xs[lo], x1 = xs[hi], y0 = ys[lo], y1 = ys[hi];
  var size = Math.max(x1 - x0, y1 - y0, 1e-9);
  var reach = size * 10, maxSize = size * 100, kept = [];
  for (var j = 0; j < boxes.length; j++) {
    var q = boxes[j], cx = (q.minX + q.maxX) / 2, cy = (q.minY + q.maxY) / 2;
    var dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
    var dy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
    if (Math.max(dx, dy) > reach) continue;
    if (Math.max(q.maxX - q.minX, q.maxY - q.minY) > maxSize) continue;
    kept.push(q);
  }
  return kept.length > 0 ? kept : boxes;
}
`;

const SITES = [
  [
    `  collectSpatialExtentBoxes() {
    return this._spatialIndex.all().filter(Ke2);
  }`,
    `  collectSpatialExtentBoxes() {
    const x = this._extentExcludedObjectIds;
    return this._spatialIndex.all().filter((o) => Ke2(o) && !x.has(o.id));
  }`,
  ],
  [
    `      Ke2(o) && i.push(o), (n & 2047) === 2047 && await e.maybeYield();
    }
    return i;
  }`,
    `      Ke2(o) && !this._extentExcludedObjectIds.has(o.id) && i.push(o), (n & 2047) === 2047 && await e.maybeYield();
    }
    return i;
  }`,
  ],
  [
    `async function Lb(s, e = new kp2()) {
  const t = await Mb(s, e);`,
    `async function Lb(s, e = new kp2()) {
  const t = await Mb(__dwvDropOutliers(s), e);`,
  ],
];

export async function patchExtents(file) {
  let text = await readFile(file, 'utf8');
  if (text.includes(MARK)) return file;
  for (const [site, repl] of SITES) {
    const first = text.indexOf(site);
    if (first === -1) throw new Error('vendor-patch-extents: site not found (upstream changed?)');
    if (text.indexOf(site, first + 1) !== -1) throw new Error('vendor-patch-extents: site matches more than once');
    text = text.slice(0, first) + repl + text.slice(first + site.length);
  }
  const at = text.indexOf('async function Lb(s, e = new kp2()) {');
  text = text.slice(0, at) + HELPER + text.slice(at);
  await writeFile(file, text);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await patchExtents(process.argv[2]);
  console.log('patched', process.argv[2]);
}
