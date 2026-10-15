/**
 * Gate for the scheduled full-tree `npm audit`.
 *
 * `npm audit` has no way to accept a single advisory, so a high-severity
 * advisory with no patched release anywhere would keep the daily job red and
 * hide every new advisory behind it. This reads `npm audit --json` and fails
 * only on high/critical advisories that are not in ALLOWLIST.
 *
 * Keep entries rare, dev-tooling only, dated, and tied to an OPEN-ISSUES id.
 * Remove an entry as soon as a fixed version can be installed.
 *
 * Usage: npm audit --json | node scripts/audit-allowlist.mjs
 * Exit codes: 0 = clean (or only allowlisted), 1 = unaccepted advisory, 2 = unreadable report.
 */

export const ALLOWLIST = {
  // 2026-10-15 (SEC-21): braces <=3.0.3 stack-exhaustion DoS. No patched version
  // exists; reached only via eslint-config-next → @next/eslint-plugin-next →
  // fast-glob → micromatch (lint tooling), whose input is our own glob patterns.
  'GHSA-vfj7-8cjw-p6xm': 'braces via eslint-config-next (dev tooling, no fix released)',
};

const BLOCKING = new Set(['high', 'critical']);

function ghsaId(url) {
  return typeof url === 'string' ? (url.match(/GHSA-[a-z0-9-]+$/i)?.[0] ?? null) : null;
}

/**
 * @param {unknown} report parsed `npm audit --json` output
 * @returns {{ blocking: {id: string|null, name: string, severity: string, title: string}[], accepted: string[] }}
 */
export function evaluateAudit(report) {
  if (!report || typeof report !== 'object' || typeof report.vulnerabilities !== 'object') {
    throw new Error('Not an npm audit --json report');
  }

  const blocking = new Map();
  const accepted = new Set();

  // Advisories appear as objects in `via`; string entries only point at another
  // vulnerable package, whose own advisory objects are visited separately.
  for (const vuln of Object.values(report.vulnerabilities)) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const id = ghsaId(via.url);
      if (id && Object.hasOwn(ALLOWLIST, id)) {
        accepted.add(id);
        continue;
      }
      blocking.set(id ?? `${via.name}:${via.source}`, {
        id,
        name: via.name,
        severity: via.severity,
        title: via.title,
      });
    }
  }

  return { blocking: [...blocking.values()], accepted: [...accepted] };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let result;
  try {
    result = evaluateAudit(JSON.parse(input));
  } catch (err) {
    process.stderr.write(`audit-allowlist: could not read the audit report (${err.message})\n`);
    process.exit(2);
  }

  for (const id of result.accepted) {
    process.stdout.write(`accepted (allowlisted): ${id} — ${ALLOWLIST[id]}\n`);
  }
  for (const b of result.blocking) {
    process.stdout.write(
      `BLOCKING ${b.severity}: ${b.name} — ${b.title} (${b.id ?? 'no GHSA id'})\n`,
    );
  }
  process.exit(result.blocking.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
