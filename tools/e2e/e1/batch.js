// Runs several Э1 scripts one after another in a single server session, so a
// whole pass costs one ssh `run` (the test server's sshd starts dropping
// connections after bursts of short sessions). Each step's output is passed
// through; STEP/STEP-END lines mark the boundaries.
//   node tools/e2e/e1/batch.js <plan.json>
// plan.json: [["tools/e2e/e1/open-corpus.js", "arg", ...], ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let failed = 0;
for (const step of plan) {
  const t0 = Date.now();
  console.log('STEP ' + step.join(' '));
  const r = spawnSync(process.execPath, step, { stdio: 'inherit', env: process.env, timeout: 30 * 60 * 1000 });
  const rc = r.status ?? (r.signal ? `signal ${r.signal}` : 'error');
  if (rc !== 0) failed++;
  console.log(`STEP-END rc=${rc} s=${Math.round((Date.now() - t0) / 1000)} :: ${step[0]}`);
}
console.log(`BATCH-END steps=${plan.length} failed=${failed}`);
process.exit(0);
