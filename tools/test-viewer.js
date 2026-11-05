// Focused regressions for the actual print handler and layout navigation.
// Native Chrome Print/PDF is verified separately on the Air; this is not that gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export function testViewer(root = fileURLToPath(new URL('../src/viewer/', import.meta.url))) {
  const source = readFileSync(path.join(root, 'viewer.js'), 'utf8');
  const html = readFileSync(path.join(root, 'viewer.html'), 'utf8');
  const engine = readFileSync(path.join(root, 'engine.js'), 'utf8');
  const failed = [];
  let total = 0;
  const run = (name, fn) => {
    total++;
    try { fn(); } catch (e) { failed.push(`${name}: ${e.message}`); }
  };
  const section = (text, start, end) => {
    const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, 'Function-section boundaries must exist');
    return text.slice(a, b);
  };
  const printSource = section(source, 'function buildPrintSheet()', 'function enterView()');
  const layoutSource = section(engine, 'export function showLayout(', 'export async function open(').replace('export ', '');
  const panDeclaration = engine.match(/^const PAN_VIEW_MODE = \d+;$/m)?.[0] ?? '';

  function printFixture(state = 'view') {
    const tag = html.match(/<(canvas|img)\b[^>]*\bid="printShot2"[^>]*>/)?.[1];
    assert.ok(tag, 'The actual print element must exist');
    const handlers = new Map();
    const shot = { width: 0, height: 0, src: '', bitmap: null, removeAttribute() { this.src = ''; } };
    if (tag === 'canvas') shot.getContext = () => ({ drawImage(canvas) { shot.bitmap = canvas; } });
    const els = Object.fromEntries(['printName', 'printLayout', 'printDate', 'printLayers', 'printObjects', 'pageStyle'].map(id => [id, { textContent: '' }]));
    els.printShot2 = shot;
    const prepared = { width: 3500, height: 1575 };
    const context = vm.createContext({
      state, current: { meta: { name: 'real.dwg' }, counts: { drawn: 156, total: 158 } }, els,
      engine: { layersInfo: () => [{ on: true }], printCanvas: () => prepared, printView: () => 'data:image/png;base64,pending-image' },
      activeLayoutName: () => 'Model', fmtInt: String, msg: (...args) => args.join(' '),
      document: { querySelector: () => ({ clientWidth: 1400, clientHeight: 630 }) },
      window: { addEventListener(name, fn) { handlers.set(name, fn); } }, Intl, Date,
    });
    vm.runInContext(printSource, context);
    return { shot, prepared, fire: name => { assert.ok(handlers.has(name)); handlers.get(name)(); } };
  }

  run('print: native beforeprint has raster pixels synchronously, without image loading', () => {
    const p = printFixture();
    p.fire('beforeprint');
    assert.equal(p.shot.bitmap, p.prepared, 'No synchronous print raster: the real old img/src implementation waits for decoding');
    assert.equal(p.shot.width, 3500);
    assert.equal(p.shot.height, 1575);
  });
  run('print: afterprint releases the print raster', () => {
    const p = printFixture();
    p.fire('beforeprint');
    p.fire('afterprint');
    assert.equal(p.shot.width, 0);
    assert.equal(p.shot.height, 0);
  });
  run('print: start screen does not prepare a drawing', () => {
    const p = printFixture('start');
    p.fire('beforeprint');
    assert.equal(p.shot.bitmap, null);
    assert.equal(p.shot.width, 0);
  });
  for (const fit of [true, false]) run(`pan: switching layout enables left-drag mode, fit=${fit}`, () => {
    let mode = 0, fits = 0;
    const view = {
      set activeLayoutBtrId(id) { this.id = id; mode = 0; },
      set mode(value) { mode = value; },
    };
    const context = vm.createContext({ view: () => view, fit: () => { fits++; } });
    vm.runInContext(panDeclaration + '\n' + layoutSource + `\nshowLayout('paper', { fit: ${fit} });`, context);
    assert.equal(mode, 1, 'Selection mode leaves LEFT unbound and only MIDDLE can pan');
    assert.equal(fits, fit ? 1 : 0);
  });
  return { total, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = testViewer(process.argv[2]);
  for (const failure of result.failed) console.error('FAIL ' + failure);
  console.log(`${result.total - result.failed.length}/${result.total} viewer regressions passed`);
  process.exitCode = result.failed.length ? 1 : 0;
}
