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
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCspEval } from './vendor-patch-csp.js';
import { patchSpline } from './vendor-patch-spline.js';

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
];
const rows = [];
for (const name of DIRECT) {
  const m = await pkgMeta(name);
  rows.push(`| ${m.name} | ${m.version} | ${m.license} | ${m.url} |`);
}
const lwVer = (await pkgMeta('@mlightcad/libredwg-web')).version;
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
that package; the exact sources and build scripts are the libredwg-web
repository at tag v${lwVer}.
`;
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices);
console.log('THIRD_PARTY_NOTICES.md regenerated');
