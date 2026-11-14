// Fails when original game files are tracked or staged. They live in
// assets-local/ or AOE1_DIR only, never in git.
import { execFileSync } from 'node:child_process';

const forbiddenExtensions = ['.drs', '.slp', '.dat', '.wav', '.mid', '.exe', '.dll'];
const forbiddenDir = 'assets-local/';

// `git ls-files` lists the index, so staged additions count as tracked.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0')
  .filter(Boolean);

const offenders = files.filter((file) => {
  const lower = file.toLowerCase();
  return lower.startsWith(forbiddenDir) || forbiddenExtensions.some((ext) => lower.endsWith(ext));
});

if (offenders.length > 0) {
  console.error('tracked-file guard: original game files must not be tracked or staged:');
  for (const file of offenders) console.error(`  ${file}`);
  console.error('Keep them in assets-local/ (gitignored) or AOE1_DIR, and `git rm --cached` them.');
  process.exit(1);
}
console.log(`tracked-file guard: ok (${files.length} tracked files checked)`);
