/**
 * Runner for `npm run script` — executes a scripts/ file inside the deployed
 * app container of the chosen environment:
 *
 *   npm run script <staging|production> <script-file> [args...]
 *   npm run script staging backfill-facility-timezones.ts
 *   npm run script -- staging backfill-facility-timezones.ts --dry-run
 *
 * Every argument after <script-file> is forwarded to the target script verbatim
 * — flags and positionals alike. Put the `--` separator before <env> whenever any
 * argument starts with a dash: without it npm consumes the flag instead of
 * passing it on (an unrecognised one makes npm exit 1; `--dry-run` happens to be
 * a real npm flag, so npm swallows it silently — see DRY-RUN RESCUE below).
 *
 * EXECUTION CONVENTION (uniform across every script in scripts/): a mutating
 * script APPLIES its changes by default, and `--dry-run` makes it report what it
 * would do while writing nothing. There is no other gate — no `--apply`, no
 * `--yes`, no `CONFIRM_*` environment variable. Preview a destructive script
 * with `--dry-run` before running it for real.
 *
 * Must be run on the target server: it wraps
 *   docker exec lms-<env>-app npx tsx scripts/<script-file>
 * and the container's environment already carries that env's variables, so no
 * env file is needed. For local runs, call tsx directly instead:
 *   set -a && source .env.local && set +a && npx tsx scripts/<script-file>
 */
import { spawnSync } from 'node:child_process';

const [env, script, ...args] = process.argv.slice(2);

if ((env !== 'staging' && env !== 'production') || !script) {
  console.error('Usage: npm run script <staging|production> <script-file> [args...]');
  process.exit(1);
}

const container = `lms-${env}-app`;
const scriptPath = `scripts/${script.replace(/^scripts\//, '')}`;

// DRY-RUN RESCUE: `npm run script <env> <file> --dry-run` (no `--` separator)
// never reaches us — `--dry-run` is a genuine npm flag, so npm eats it and only
// records it as npm_config_dry_run. Under this convention that silence is
// dangerous: the operator asked for a preview and would instead get a real,
// possibly destructive run. npm's own config tells us the intent, so re-inject
// the flag. Erring toward a preview is always the safe direction.
const forwarded = [...args];
if (process.env.npm_config_dry_run === 'true' && !forwarded.includes('--dry-run')) {
  console.warn(
    'note: npm consumed your --dry-run flag; forwarding it anyway. ' +
      'Use `npm run script -- <env> <file> --dry-run` to pass flags directly.',
  );
  forwarded.push('--dry-run');
}

const result = spawnSync('docker', ['exec', container, 'npx', 'tsx', scriptPath, ...forwarded], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to run docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
