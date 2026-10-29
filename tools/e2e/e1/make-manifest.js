// Corpus manifest builder (ТЗ 4.2): scans fixture dirs, reads the DWG/DXF
// version from the first 6 bytes, emits a JSON array manifest.
//   node tools/e2e/e1/make-manifest.js [--root <dir>]... [--out <file>] [--only <substr>]...
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const roots = [];
let out = null;
const only = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') roots.push(args[++i]);
  else if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--only') only.push(args[++i]);
}

function versionOf(bytes) {
  const head = bytes.subarray(0, 6).toString('latin1');
  const m = head.match(/^AC\d{4}$/);
  if (m) return { code: head, family: 'dwg' };
  const binSentinel = 'AutoCAD Binary DXF';
  const head1k = bytes.subarray(0, 4096).toString('latin1');
  if (head1k.startsWith(binSentinel)) {
    const v = head1k.match(/ACADVER[\s\S]{1,80}?AC(\d{4})/);
    return { code: v ? `AC${v[1]}` : null, family: 'dxf', binary: true };
  }
  const v = head1k.match(/\$?ACADVER[\s\S]{1,80}?AC(\d{4})/);
  if (v) return { code: `AC${v[1]}`, family: 'dxf' };
  // DXF without a header section (r12-style minimal files): ASCII DXF still
  // begins with "  0\nSECTION"-like text.
  if (/^\s*0\s*\r?\n\s*SECTION/.test(head1k) || /^999/.test(head1k)) {
    return { code: null, family: 'dxf' };
  }
  return { code: null, family: null };
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(dxf|dxfb|dwg)$/i.test(e.name)) {
      const bytes = fs.readFileSync(p);
      const { code, family, binary } = versionOf(bytes);
      acc.push({
        path: path.relative(process.cwd(), p),
        name: e.name,
        bytes: bytes.length,
        code: family === 'dwg' ? code : code,
        dxfBinary: binary || undefined,
        kind: family,
      });
    }
  }
}

let acc = [];
if (!roots.length) {
  roots.push(
    'tools/e2e/fixtures-local/libredwg-testdata',
    'tools/e2e/fixtures/synthetic',
  );
}
for (const r of roots) {
  if (fs.existsSync(r)) walk(r, acc);
  else console.error(`SKIP missing root ${r}`);
}

if (only.length) acc = acc.filter((f) => only.some((s) => f.path.includes(s)));

acc.sort((a, b) => a.path.localeCompare(b.path));
const json = JSON.stringify(acc, null, 1);
if (out) {
  fs.writeFileSync(out, json);
  console.log(`manifest ${out} files=${acc.length}`);
} else {
  console.log(json);
}
for (const f of acc) console.error(`MF ${f.path} ${f.code ?? f.kind ?? '?'}`);
