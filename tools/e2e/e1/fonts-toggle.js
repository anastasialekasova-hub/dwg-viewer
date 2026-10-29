// A/B helper for the fallback-font cost (E1 call 3): on the test-server mirror
// only, `off` empties src/vendor/fonts/fonts.json (engine has no font, as
// before b4f3b46), `on` restores it from the saved copy. Never run in the repo.
//   node tools/e2e/e1/fonts-toggle.js off|on
import fs from 'node:fs';
const f = 'src/vendor/fonts/fonts.json';
const keep = 'tools/e2e/out/fonts.json.keep';
fs.mkdirSync('tools/e2e/out', { recursive: true });
if (process.argv[2] === 'off') {
  if (!fs.existsSync(keep)) fs.copyFileSync(f, keep);
  fs.writeFileSync(f, '[]\n');
} else {
  fs.copyFileSync(keep, f);
}
console.log('FONTS ' + process.argv[2] + ' ' + fs.readFileSync(f, 'utf8').replace(/\s+/g, ' ').slice(0, 120));
