// Light-canvas colour mapping hook (ТЗ F-11 / F-15, дизайн 5.6): the engine
// resolves entity colours to final RGB in a few module-local places, and none
// of them know about our Light background. This patch routes every resolved
// colour through a globalThis.__dwgColorMap hook that src/lib/colors.js sets
// when Light mode or print is active; unset (or non-function), the hook is an
// identity and nothing changes for the Dark default.
//
// Patched sites (all colour-to-material paths in the bundle):
//   1. AcGiContext.resolveSubEntityTraitsRgb — the shared resolver used by
//      line/point/fill material managers AND by text colour settings
//      (buildColorSettingsFromTraits). One wrap covers both.
//   2. AcTrMaterialManager.resolveMaterialRgb — the ByLayer branch returns the
//      layer-table RGB directly, bypassing the context resolver.
//   3. AcTrMaterialManager.refreshMaterialResolvedColor — layer-table swatch
//      refresh paints materials straight from color.RGB (both branches).
// Applied by vendor-build.js; fails loudly if upstream drifts.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MARK = '/* DWG Viewer patch: color map */';

// Top-level helper: the call sites live in different __esm() init blocks, so
// the function must sit at bundle module scope, above every block.
const HELPER = `${MARK}
function __dwgMapRgb(rgb) {
  const f = globalThis.__dwgColorMap;
  return typeof f == "function" && typeof rgb == "number" ? f(rgb) : rgb;
}`;

// The original body is renamed into a plain function the wrapper delegates to.
const SITE_RESOLVE = `      AcGiContext2.prototype.resolveSubEntityTraitsRgb = function(traits) {`;
const REPL_RESOLVE = `      AcGiContext2.prototype.resolveSubEntityTraitsRgb = function(traits) {
        return __dwgMapRgb(__dwgResolveSubEntityTraitsRgbOrig.call(this, traits));
      };
      function __dwgResolveSubEntityTraitsRgbOrig(traits) {`;

const SITE_BYLAYER = `    return e.color.isByLayer && typeof t == "number" ? t : this.resolveTraitsRgb(e);`;
const REPL_BYLAYER = `    return __dwgMapRgb(e.color.isByLayer && typeof t == "number" ? t : this.resolveTraitsRgb(e));`;

const SITE_REFRESH_HEAD = `        new Color(
          acgiForegroundColorForBackground(this.options.currentBackgroundColor)
        )`;
const REPL_REFRESH_HEAD = `        new Color(
          __dwgMapRgb(
            acgiForegroundColorForBackground(this.options.currentBackgroundColor)
          )
        )`;

const SITE_REFRESH_RGB = `T2.setMaterialColor(e, new Color(n)));`;
const REPL_REFRESH_RGB = `T2.setMaterialColor(e, new Color(__dwgMapRgb(n))));`;

// refreshLayerBoundMaterialColor: layer-bound text / INSERT materials repainted
// from the layer record on layer-table changes (site 5).
const SITE_LAYER_BOUND = `    const s = r && i ? acgiForegroundColorForBackground(i.currentBackgroundColor) : (c = t.color) == null ? void 0 : c.RGB;`;
const REPL_LAYER_BOUND = `    const s = __dwgMapRgb(
      r && i ? acgiForegroundColorForBackground(i.currentBackgroundColor) : (c = t.color) == null ? void 0 : c.RGB
    );`;

export async function patchColors(file) {
  let text = await readFile(file, 'utf8');
  if (text.includes(MARK)) return file;
  // helper at top level, right after the vendor banner comment
  const bannerEnd = text.indexOf(' */\n');
  const at = bannerEnd === -1 ? 0 : bannerEnd + 4;
  text = text.slice(0, at) + HELPER + '\n' + text.slice(at);
  for (const [site, repl, name] of [
    [SITE_RESOLVE, REPL_RESOLVE, 'context resolver'],
    [SITE_BYLAYER, REPL_BYLAYER, 'ByLayer material rgb'],
    [SITE_REFRESH_HEAD, REPL_REFRESH_HEAD, 'layer swatch foreground'],
    [SITE_REFRESH_RGB, REPL_REFRESH_RGB, 'layer swatch rgb'],
    [SITE_LAYER_BOUND, REPL_LAYER_BOUND, 'layer-bound material rgb'],
  ]) {
    const first = text.indexOf(site);
    if (first === -1) throw new Error(`vendor-patch-colors: site not found (${name}; upstream changed?)`);
    if (text.indexOf(site, first + 1) !== -1) {
      throw new Error(`vendor-patch-colors: site matches more than once (${name})`);
    }
    text = text.slice(0, first) + repl + text.slice(first + site.length);
  }
  await writeFile(file, text);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await patchColors(process.argv[2]);
  console.log('patched', process.argv[2]);
}
