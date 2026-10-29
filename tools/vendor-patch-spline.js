// SPLINE patch (ТЗ 4.2.1): data-model's AcDbSpline.fromDwgSpline returns null
// for a closed fit-point spline with fewer than degree+1 fit points (the
// geometry kernel needs >= 4 points for a closed NURBS), so the entity is
// dropped before it reaches the database and the counter never sees it.
// AutoCAD accepts such splines (libredwg testdata Spline.dwg: closed, 3 fit
// points). Fallback: draw an open fit spline through the points and back to
// the first one. Applied by vendor-build.js; fails loudly if upstream drifts.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SITE = `        if (fitPointCount > 0) {
          return AcDbSpline2.fromFitPoints(spline.fitPoints, knotParam, spline.degree, closed, spline.startTangent, spline.endTangent);
        }`;
const REPL = `        if (fitPointCount > 0) {
          var fromFit = AcDbSpline2.fromFitPoints(spline.fitPoints, knotParam, spline.degree, closed, spline.startTangent, spline.endTangent);
          // DWG Viewer patch: closed spline with too few fit points -> open loop through them.
          if (!fromFit && closed && spline.fitPoints && spline.fitPoints.length >= 2) {
            fromFit = AcDbSpline2.fromFitPoints(spline.fitPoints.concat([spline.fitPoints[0]]), knotParam, spline.degree, false, void 0, void 0);
          }
          return fromFit;
        }`;

export async function patchSpline(file) {
  const text = await readFile(file, 'utf8');
  if (text.includes('DWG Viewer patch: closed spline')) return file;
  const first = text.indexOf(SITE);
  if (first === -1) throw new Error('vendor-patch-spline: site not found (upstream changed?)');
  if (text.indexOf(SITE, first + 1) !== -1) throw new Error('vendor-patch-spline: site matches more than once');
  await writeFile(file, text.slice(0, first) + REPL + text.slice(first + SITE.length));
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await patchSpline(process.argv[2]);
  console.log('patched', process.argv[2]);
}
