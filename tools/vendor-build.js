// Vendors the CAD engine into src/vendor/ per ТЗ 7.3:
//   - @mlightcad/cad-simple-viewer (+deps)  -> src/vendor/cad-viewer.js
//   - @mlightcad/libredwg-converter parser worker (+deps)
//                                           -> src/vendor/libredwg-worker.js
//   - @mlightcad/cad-simple-viewer mtext worker -> src/vendor/mtext-renderer-worker.js
//   - @mlightcad/libredwg-web wasm (copy)   -> src/vendor/libredwg-web.wasm
// ESM, no minification, legalComments 'inline'. Every .js output gets a
// header: package, version, license, source URL. The wasm is binary and
// stays untouched; its provenance lives in THIRD_PARTY_NOTICES.md.
// The wasm must keep this exact name next to libredwg-worker.js: the
// emscripten glue resolves it relative to the worker bundle (import.meta.url).
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCspEval } from './vendor-patch-csp.js';
import { patchSpline } from './vendor-patch-spline.js';
import { patchYield } from './vendor-patch-yield.js';
import { patchExtents } from './vendor-patch-extents.js';
import { patchPrint } from './vendor-patch-print.js';
import { patchColors } from './vendor-patch-colors.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'src', 'vendor');
const nm = (p) => path.join(root, 'node_modules', p);

async function pkgMeta(name) {
  const j = JSON.parse(await readFile(nm(`${name}/package.json`), 'utf8'));
  const repo = typeof j.repository === 'string' ? j.repository : j.repository?.url ?? '';
  return { name, version: j.version, license: j.license, url: repo.replace(/^git\+|\.git$/g, '') };
}

const SOURCES = {
  cadViewer: await pkgMeta('@mlightcad/cad-simple-viewer'),
  worker: await pkgMeta('@mlightcad/libredwg-converter'),
  mtextWorker: await pkgMeta('@mlightcad/cad-simple-viewer'),
  wasm: await pkgMeta('@mlightcad/libredwg-web'),
};

function header(meta, note) {
  const lines = [
    `Package: ${meta.name} ${meta.version}`,
    `License: ${meta.license}`,
    `Source: ${meta.url}`,
  ];
  if (note) lines.push(`Note: ${note}`);
  lines.push('Vendored by tools/vendor-build.js — do not edit.');
  return `/*\n${lines.map((l) => ` * ${l}`).join('\n')}\n */\n`;
}

const COMMON = {
  bundle: true,
  format: 'esm',
  minify: false,
  legalComments: 'inline',
  sourcemap: false,
  target: ['chrome116'],
  logLevel: 'warning',
  plugins: [threeSubpaths(), nodeExternals()],
};

// The emscripten glue carries a Node.js branch (`await import("node:module")`)
// that never runs in the browser; keep it as-is instead of failing on it.
function nodeExternals() {
  return {
    name: 'node-externals',
    setup(b) {
      b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }));
    },
  };
}

// The `three` package's exports map only matches exact subpaths, and the
// published mlightcad bundles import extensionless examples paths
// ("three/examples/jsm/controls/OrbitControls"). Resolve `three/*` directly
// from the installed files instead of through the exports map.
function threeSubpaths() {
  const threeDir = nm('three');
  return {
    name: 'three-subpaths',
    setup(b) {
      b.onResolve({ filter: /^three(\/|$)/ }, (args) => {
        const sub = args.path === 'three' ? 'build/three.module.js' : args.path.slice('three/'.length);
        for (const cand of [sub, sub + '.js', sub + '.mjs', path.join(sub, 'index.js')]) {
          const abs = path.join(threeDir, cand);
          if (existsSync(abs)) return { path: abs };
        }
        return null;
      });
    },
  };
}

const BUNDLES = [
  {
    entry: path.join(root, 'tools', 'vendor', 'cad-viewer-entry.js'),
    out: path.join(vendorDir, 'cad-viewer.js'),
    meta: SOURCES.cadViewer,
    note: 'Viewer engine: AcApDocManager, scenes, adapters (bundled with three, lodash-es, @mlightcad/three-renderer, mtext-parser, mtext-renderer, data-model, @mlightcad/libredwg-converter). Wrapper entry: tools/vendor/cad-viewer-entry.js re-exports the names used by the extension.',
  },
  {
    entry: nm('@mlightcad/libredwg-converter/lib/AcDbLibreDwgParserWorker.js'),
    out: path.join(vendorDir, 'libredwg-worker.js'),
    meta: SOURCES.worker,
    note: 'DWG parser module worker. Loads libredwg-web.wasm from its own directory.',
  },
  {
    entry: nm('@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js'),
    out: path.join(vendorDir, 'mtext-renderer-worker.js'),
    meta: SOURCES.mtextWorker,
    note: 'Self-contained MTEXT rendering module worker.',
  },
];

await mkdir(vendorDir, { recursive: true });
for (const b of BUNDLES) {
  await build({ ...COMMON, entryPoints: [b.entry], outfile: b.out, banner: { js: header(b.meta, b.note) } });
  const size = (await stat(b.out)).size;
  console.log(`${path.relative(root, b.out)}: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

// MV3 CSP forbids 'unsafe-eval'; the emscripten runtime in the DWG worker
// builds embind/emval invokers via new Function. Patch both sites post-build.
await patchCspEval(path.join(vendorDir, 'libredwg-worker.js'));

// Closed fit-point splines with < degree+1 points are dropped upstream (4.2.1).
await patchSpline(path.join(vendorDir, 'cad-viewer.js'));
await patchYield(path.join(vendorDir, 'cad-viewer.js'));
// Fit ignored XLINE / RAY exclusion and far outliers -> blank canvas (4.2.1, F-8).
await patchExtents(path.join(vendorDir, 'cad-viewer.js'));
// WebGL buffer cleared before Chrome's print snapshot -> blank PDF (4.2.13, F-12).
await patchPrint(path.join(vendorDir, 'cad-viewer.js'));
// Light background / print palette: route resolved colours through the
// globalThis.__dwgColorMap hook (F-11, F-15).
await patchColors(path.join(vendorDir, 'cad-viewer.js'));

// Zero network (4.2.6): the mtext worker bakes in the engine's CDN font
// catalog default and fetches fonts.json with it during boot, before any
// setFontUrl message lands. A relative base resolves against the worker
// script URL (src/vendor/), i.e. our shipped src/vendor/fonts/ catalog.
const mtextOut = path.join(vendorDir, 'mtext-renderer-worker.js');
const CDN_FONTS = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data/fonts/';
{
  const src = await readFile(mtextOut, 'utf8');
  if (!src.includes(CDN_FONTS)) {
    throw new Error(`mtext worker: expected CDN font default not found — upstream drifted`);
  }
  await writeFile(mtextOut, src.split(CDN_FONTS).join('fonts/'));
  console.log('patched mtext worker font catalog default -> same-origin fonts/');
}

// Text without the drawing's fonts (4.2.1): the engine's catalog is a CDN we
// never call, so with an empty fonts.json every TEXT/MTEXT stayed invisible.
// Fallback font (E1 4.2.4: the full DejaVu cost 45 s / 2.4 GB on
// architectural.dwg): a Latin+Cyrillic+Greek+symbols subset of DejaVu Sans,
// rebuilt here when the venv's pyftsubset is available, otherwise copied from
// the last committed build. The subset is a MODIFIED DejaVu — the Bitstream
// Vera license forbids modified versions carrying the DejaVu/Vera name, so
// the file (and its name table) is renamed Cad Sans; the full unmodified
// DejaVuSans.ttf stays out of the package. Registered under the engine's
// default-chain names (simsun, hztxt included); the drawing's own font names
// stay in missedFonts (the banner still lists them).
const fontsDir = path.join(vendorDir, 'fonts');
await mkdir(fontsDir, { recursive: true });
const FONT = { pkg: 'dejavu-fonts-ttf', file: 'DejaVuSans.ttf', out: 'CadSans-subset.ttf' };
const SUBSET_UNICODES =
  'U+0020-007E,U+00A0-00FF,U+0100-017F,U+0384-03CE,U+0391-03A9,U+03B1-03C9,U+0400-045F,U+0490-0491,' +
  'U+1EA0-1EF9,U+2010-2027,U+2030-203A,U+20AC,U+2103,U+2116,U+2122,U+00B0-00B3,U+00D7,U+00F7,' +
  'U+2190-2193,U+2202,U+2211,U+2212,U+221E,U+2220,U+2248,U+2260-2265,U+2302,U+25A0-25CB,U+25CF,U+25E6';
const pyft = ['tools/.venv/bin/pyftsubset', 'tools/.venv/Scripts/pyftsubset.exe'].find((p) => existsSync(path.join(root, p)));
let subsetKB;
if (pyft) {
  await execFileSync(path.join(root, pyft), [
    nm(`${FONT.pkg}/ttf/${FONT.file}`),
    `--output-file=${path.join(fontsDir, FONT.out)}`,
    `--unicodes=${SUBSET_UNICODES}`,
    '--layout-features=',
    '--no-hinting',
    '--name-IDs=',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  subsetKB = ((await stat(path.join(fontsDir, FONT.out))).size / 1024).toFixed(0);
} else {
  await copyFile(path.join(root, 'tools/vendor', FONT.out), path.join(fontsDir, FONT.out));
  subsetKB = `${((await stat(path.join(fontsDir, FONT.out))).size / 1024).toFixed(0)} (prebuilt)`;
}
await copyFile(nm(`${FONT.pkg}/LICENSE`), path.join(fontsDir, 'DejaVu-LICENSE.txt'));
await writeFile(
  path.join(fontsDir, 'fonts.json'),
  JSON.stringify([{ name: ['dejavusans', 'dejavu sans', 'simsun', 'hztxt', 'cadsans', 'cad sans'], file: FONT.out, type: 'mesh' }], null, 1) + '\n',
);
console.log(`src/vendor/fonts/${FONT.out}: ${subsetKB} KB (fallback font subset)`);
await rm(path.join(fontsDir, 'DejaVuSans.ttf'), { force: true });

const wasmSrc = nm('@mlightcad/libredwg-web/wasm/libredwg-web.wasm');
const wasmOut = path.join(vendorDir, 'libredwg-web.wasm');
await copyFile(wasmSrc, wasmOut);
console.log(`${path.relative(root, wasmOut)}: ${((await stat(wasmOut)).size / 1024 / 1024).toFixed(2)} MB`);

// THIRD_PARTY_NOTICES.md — regenerated from the pinned installed packages.
const DIRECT = [
  '@mlightcad/cad-simple-viewer',
  '@mlightcad/libredwg-converter',
  '@mlightcad/libredwg-web',
  '@mlightcad/data-model',
  '@mlightcad/mtext-parser',
  '@mlightcad/mtext-renderer',
  '@mlightcad/three-renderer',
  'three',
  'lodash-es',
  'dejavu-fonts-ttf',
];
const rows = [];
for (const name of DIRECT) {
  const m = await pkgMeta(name);
  rows.push(`| ${m.name} | ${m.version} | ${m.license} | ${m.url} |`);
}
const lwVer = (await pkgMeta('@mlightcad/libredwg-web')).version;
const fontRow = `| CadSans-subset.ttf (subset of DejaVu Sans) | ${String((await pkgMeta('dejavu-fonts-ttf')).version)} | Bitstream Vera license (fonts) / public domain (modifications) | https://github.com/dejavu-fonts/dejavu-fonts |`;
const notices = `# Third-party notices

Generated by tools/vendor-build.js from the pinned versions in package.json.
This extension includes GPL-3.0 components (see LICENSE); the whole work is
distributed under GPL-3.0-or-later (ТЗ 7.9).

| Package | Version | License | Source |
|---|---|---|---|
${rows.map((r) => r).join('\n')}

## libredwg-web.wasm

The vendored \`src/vendor/libredwg-web.wasm\` is a byte-for-byte copy of
\`@mlightcad/libredwg-web@${lwVer}\` \`wasm/libredwg-web.wasm\` (GPL-3.0,
https://github.com/mlightcad/libredwg-web). It is a build of LibreDWG
(https://github.com/LibreDWG/libredwg, GPL-3.0) compiled to WebAssembly by
that package. The upstream source reference is the libredwg-web repository
at tag v${lwVer}; this reference is not an independently verified record of
the native compilation inputs. The npm tarball is a distribution package,
not a complete corresponding-source bundle.

## src/vendor/fonts/CadSans-subset.ttf

A glyph subset (Latin, Cyrillic, Greek, Vietnamese, common CAD symbols,
punctuation) of \`DejaVuSans.ttf\` from \`dejavu-fonts-ttf@${(await pkgMeta('dejavu-fonts-ttf')).version}\`
(DejaVu Fonts 2.37, https://dejavu-fonts.github.io/), built by
tools/vendor-build.js with pyftsubset (fontTools), hinting and layout
features dropped. License: Bitstream Vera Fonts license with DejaVu changes
in the public domain; full text in \`src/vendor/fonts/DejaVu-LICENSE.txt\`.
Modified font files must not carry the DejaVu/Vera name, so the subset is
renamed "Cad Sans" (the name table is stripped). Used only as the fallback
for text whose own font is not in the drawing.

${fontRow}

## npm distribution archives

The pinned npm tarballs in \`third_party-sources/\` are published
JS/declaration/binary distributions, not complete source trees. They do
not include the C/C++/embind implementation or all native build inputs.
Do not present those tarballs as a complete corresponding-source bundle.

## Component source delivery

The exact pinned source trees, licenses, build inputs and restoration
instructions are supplied separately from the npm distributions. The
source archive must be kept with all three self-contained Git history
bundles: upstream bootstrap/version scripts use that history. See
\`third_party-sources/README.md\` for asset names, exact commits, checksums,
verification limits and the matching release. Native builds and
bit-for-bit binary reproduction must not be inferred from source presence.
`;
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices);
console.log('THIRD_PARTY_NOTICES.md regenerated');
