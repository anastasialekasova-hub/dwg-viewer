// Probe: confirm the synced harness copy on the server has the latest edits.
import fs from 'node:fs';
const s = fs.readFileSync('tools/e2e/e1/diag-open.js', 'utf8');
console.log('PROBE lines=' + s.split('\n').length + ' armPage=' + s.includes('armPage'));
const c = fs.readFileSync('tools/e2e/e1/open-corpus.js', 'utf8');
console.log('PROBE corpus_extList=' + c.includes('extList'));
