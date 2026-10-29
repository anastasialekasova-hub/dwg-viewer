// Print patch (ТЗ 4.2.13, F-12 "Print / Save as PDF"): the engine creates its
// three.js WebGLRenderer with preserveDrawingBuffer=false, so by the time
// Chrome snapshots the page for print the canvas buffer is already cleared and
// the PDF sheet is blank. Measured on the test server (print.js, E1 call 2):
// 0.03 % dark pixels in the PDF centre without the flag, 100 % with it forced.
// This patch passes preserveDrawingBuffer: true to that one renderer.
// Applied by vendor-build.js; fails loudly if upstream drifts.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MARK = '/* DWG Viewer patch: print buffer */';
const SITE = `    const n = new WebGLRenderer({
      antialias: true,
      alpha: true
    });`;
const REPL = `    const n = new WebGLRenderer({
      antialias: true,
      alpha: true,
      ${MARK} preserveDrawingBuffer: true
    });`;

export async function patchPrint(file) {
  let text = await readFile(file, 'utf8');
  if (text.includes(MARK)) return file;
  const first = text.indexOf(SITE);
  if (first === -1) throw new Error('vendor-patch-print: site not found (upstream changed?)');
  if (text.indexOf(SITE, first + 1) !== -1) throw new Error('vendor-patch-print: site matches more than once');
  text = text.slice(0, first) + REPL + text.slice(first + SITE.length);
  await writeFile(file, text);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await patchPrint(process.argv[2]);
  console.log('patched', process.argv[2]);
}
