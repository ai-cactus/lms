/**
 * Runner for `npm run script` — executes a scripts/ file inside the deployed
 * app container of the chosen environment:
 *
 *   npm run script <staging|production> <script-file> [-- args]
 *   npm run script staging backfill-roles.ts
 *   npm run script -- staging backfill-roles.ts --dry-run
 *
 * Must be run on the target server: it wraps
 *   docker exec lms-<env>-app npx tsx scripts/<script-file>
 * and the container's environment already carries that env's variables, so no
 * env file is needed. For local runs, call tsx directly instead:
 *   set -a && source .env.local && set +a && npx tsx scripts/<script-file>
 */
import { spawnSync } from 'node:child_process';

const [env, script, ...args] = process.argv.slice(2);

if (env !== 'staging' && env !== 'production' || !script) {
  console.error('Usage: npm run script <staging|production> <script-file> [-- args]');
  process.exit(1);
}

const container = `lms-${env}-app`;
const scriptPath = `scripts/${script.replace(/^scripts\//, '')}`;

const result = spawnSync('docker', ['exec', container, 'npx', 'tsx', scriptPath, ...args], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to run docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
