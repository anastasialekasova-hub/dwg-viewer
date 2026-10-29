// Hidden-tab patch (ТЗ 4.2.9, 6.2): the engine yields to the UI between
// parse/convert batches with requestAnimationFrame (accmYieldToUi: one frame,
// accmYieldForPaint: two). Chrome does not run rAF callbacks in a background
// tab, so a drawing opened in a tab the user is not looking at (link opened
// next to the page, user switched away while it loads) stalls at
// CONVERSION|START until the tab is shown again, while the open deadline keeps
// running — and ends on a false "too large" card. Measured on the test server:
// sample_AC1014.dwg, hidden tab, 18 s at 0 of 164 objects, rAF never fired.
// Fix: when the document is hidden, or becomes hidden while waiting for a
// frame, yield through a MessageChannel task instead (not throttled the way
// background setTimeout is). Visible tabs keep the original rAF behaviour.
// Applied by vendor-build.js; fails loudly if upstream drifts.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MARK = 'DWG Viewer patch: hidden-tab yield';

const HELPER = `// ${MARK}
function __dwvYieldFrames(frames, resolve) {
  var d = globalThis.document;
  var done = false;
  var onVis = function() {
    if (d.hidden) viaTask();
  };
  var fin = function() {
    if (done) return;
    done = true;
    if (d) d.removeEventListener("visibilitychange", onVis);
    resolve();
  };
  var viaTask = function() {
    var ch = new MessageChannel();
    ch.port1.onmessage = fin;
    ch.port2.postMessage(0);
  };
  if (d && d.hidden) return viaTask();
  if (d) d.addEventListener("visibilitychange", onVis);
  var raf = globalThis.requestAnimationFrame;
  if (frames === 2) raf(function() {
    return raf(fin);
  });
  else raf(fin);
}
`;

const SITES = [
  [
    `function accmYieldToUi() {
  return new Promise(function(resolve) {
    if (typeof globalThis !== "undefined" && typeof globalThis.requestAnimationFrame === "function") {
      ;
      globalThis.requestAnimationFrame(function() {
        return resolve();
      });
    } else {`,
    `function accmYieldToUi() {
  return new Promise(function(resolve) {
    if (typeof globalThis !== "undefined" && typeof globalThis.requestAnimationFrame === "function") {
      __dwvYieldFrames(1, resolve);
    } else {`,
  ],
  [
    `function accmYieldForPaint() {
  return new Promise(function(resolve) {
    if (typeof globalThis !== "undefined" && typeof globalThis.requestAnimationFrame === "function") {
      var raf_1 = globalThis.requestAnimationFrame;
      raf_1(function() {
        return raf_1(function() {
          return resolve();
        });
      });
    } else {`,
    `function accmYieldForPaint() {
  return new Promise(function(resolve) {
    if (typeof globalThis !== "undefined" && typeof globalThis.requestAnimationFrame === "function") {
      __dwvYieldFrames(2, resolve);
    } else {`,
  ],
];

export async function patchYield(file) {
  let text = await readFile(file, 'utf8');
  if (text.includes(MARK)) return file;
  for (const [site, repl] of SITES) {
    const first = text.indexOf(site);
    if (first === -1) throw new Error('vendor-patch-yield: site not found (upstream changed?)');
    if (text.indexOf(site, first + 1) !== -1) throw new Error('vendor-patch-yield: site matches more than once');
    text = text.slice(0, first) + repl + text.slice(first + site.length);
  }
  const at = text.indexOf('function accmYieldToUi() {');
  text = text.slice(0, at) + HELPER + text.slice(at);
  await writeFile(file, text);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await patchYield(process.argv[2]);
  console.log('patched', process.argv[2]);
}
