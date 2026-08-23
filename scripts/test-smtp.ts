/**
 * SMTP transport diagnostic — answers "why is mail not sending?" without
 * touching product data.
 *
 *   npm run script staging test-smtp.ts              # config audit + AUTH check
 *   npm run script -- staging test-smtp.ts --send me@example.com
 *
 * Run it on the target server so it reads that environment's real variables
 * from inside the app container. Locally:
 *   set -a && source .env.local && set +a && npx tsx scripts/test-smtp.ts
 *
 * By default it connects and authenticates but sends NOTHING. Pass
 * `--send <address>` to deliver a real test message once AUTH passes.
 *
 * The transporter below mirrors `src/lib/email.ts` exactly — same env-var
 * precedence, port, TLS hardening and timeouts. A diagnostic that configures
 * itself differently from production proves nothing about production.
 *
 * Secrets are never printed: the password is reported only as a length plus a
 * whitespace warning, and the account address is masked.
 */
import nodemailer from 'nodemailer';
import { maskEmail } from '@/lib/logger';

const sendIndex = process.argv.indexOf('--send');
const sendTo = sendIndex === -1 ? null : process.argv[sendIndex + 1];

if (sendIndex !== -1 && (!sendTo || sendTo.startsWith('--'))) {
  console.error('Usage: test-smtp.ts [--send <recipient-address>]');
  process.exit(1);
}

// Mirrors src/lib/email.ts:39-49 — keep in sync if that resolution changes.
const user = process.env.SMTP_USER || process.env.ZOHO_MAIL_USER;
const pass = process.env.SMTP_PASSWORD || process.env.ZOHO_MAIL_PASSWORD;
const host = process.env.SMTP_HOST || 'smtp.zoho.com';
const port = parseInt(process.env.SMTP_PORT || '465', 10);
const secure = port === 465;
const isDevelopment = process.env.NODE_ENV === 'development';
const isLoopbackSmtpSink = ['localhost', '127.0.0.1', '::1'].includes(host);
const skipSmtpHardening = isDevelopment || isLoopbackSmtpSink;

/** Which variable actually supplied a value — the fallback chain hides this. */
function source(primary: string, fallback: string): string {
  if (process.env[primary]) return primary;
  if (process.env[fallback]) return `${fallback} (fallback)`;
  return 'UNSET';
}

function reportConfig(): string[] {
  const problems: string[] = [];

  console.log('SMTP configuration');
  console.log(`  host            ${host}`);
  console.log(`  port            ${port} (secure=${secure})`);
  console.log(`  NODE_ENV        ${process.env.NODE_ENV ?? '(unset)'}`);
  console.log(
    `  user            ${user ? maskEmail(user) : 'UNSET'}  [from ${source('SMTP_USER', 'ZOHO_MAIL_USER')}]`,
  );
  console.log(
    `  password        ${pass ? `${pass.length} chars` : 'UNSET'}  [from ${source('SMTP_PASSWORD', 'ZOHO_MAIL_PASSWORD')}]`,
  );

  if (!user)
    problems.push(
      'SMTP_USER / ZOHO_MAIL_USER is unset — every send fails and the From header renders as "<undefined>".',
    );
  if (!pass) problems.push('SMTP_PASSWORD / ZOHO_MAIL_PASSWORD is unset.');

  // Zoho app passwords are displayed in space-separated groups; pasting them
  // verbatim into an env file authenticates as a different string.
  if (pass && pass.trim() !== pass) {
    problems.push(
      'Password has leading/trailing whitespace — strip it. Env files preserve it verbatim.',
    );
  }
  if (pass && /\s/.test(pass.trim())) {
    problems.push(
      'Password contains internal spaces — Zoho displays app passwords in groups of four; remove the spaces.',
    );
  }

  // The single highest-value check: production code drops auth entirely here.
  if (skipSmtpHardening && !isLoopbackSmtpSink) {
    problems.push(
      `NODE_ENV=development against remote host ${host} — src/lib/email.ts sets auth:undefined in this mode, ` +
        'so NO credentials are sent regardless of whether they are configured. Zoho will reject every message.',
    );
  }
  if (isLoopbackSmtpSink) {
    console.log('  note            loopback sink (MailHog) — auth and TLS intentionally skipped.');
  }

  return problems;
}

/** Map a transport error to the specific thing an operator should go change. */
function explain(error: unknown): string {
  const err = error as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
  };
  const response = err.response ?? err.message ?? '';

  if (err.responseCode === 535 || err.code === 'EAUTH') {
    return 'AUTH REJECTED — credentials reached the server and were refused. Rotate/reissue the Zoho app password and update the environment. This is the expected signature of a rotated password.';
  }
  if (err.responseCode === 534) {
    return 'AUTH REJECTED — Zoho requires an application-specific password for this account, not the login password.';
  }
  // Zoho throttles a sending account before it suspends one, and 2026-08-20 showed
  // the throttle wording ("limit exceeded") shares none of the vocabulary of a
  // suspension. Both land here because the remedy is the same: the admin console.
  if (
    err.responseCode === 550 ||
    err.responseCode === 552 ||
    err.responseCode === 451 ||
    /unusual|suspend|blocked|spam|limit exceeded|rate.?limit|quota|too many/i.test(response)
  ) {
    return 'ACCOUNT RESTRICTED — the account is rate-limited, over quota, suspended, or flagged for unusual sending. Resolve it in the Zoho admin console; no code or env change will help. A send-limit block clears once the window resets or support lifts it.';
  }
  if (err.code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(response)) {
    return `DNS FAILURE — cannot resolve ${host}. Check container DNS and the SMTP_HOST spelling.`;
  }
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || /ECONNREFUSED/.test(response)) {
    return `CONNECTION FAILURE — no TCP session to ${host}:${port}. Egress on that port is most likely blocked; many hosts block 465/587 outbound by default.`;
  }
  if (err.code === 'ESOCKET' || /TLS|SSL|certificate/i.test(response)) {
    return `TLS FAILURE — handshake with ${host}:${port} failed. Confirm the port matches the mode (465 implicit TLS, 587 STARTTLS).`;
  }
  return `UNCLASSIFIED — code=${err.code ?? 'n/a'} responseCode=${err.responseCode ?? 'n/a'}`;
}

async function main() {
  const problems = reportConfig();

  if (problems.length > 0) {
    console.log('\nConfiguration problems');
    problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  }

  if (!user || !pass) {
    console.log('\nRESULT: FAIL — credentials missing; not attempting a connection.');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: skipSmtpHardening ? undefined : !secure,
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
    auth: skipSmtpHardening ? undefined : { user, pass },
  });

  // When hardening is skipped the transporter carries no auth block, so verify()
  // only proves the host is reachable. Saying PASS on that basis would give a
  // clean bill of health to the exact misconfiguration this script exists to
  // catch. A loopback sink is the one legitimate case — MailHog wants no auth.
  const authExercised = !skipSmtpHardening;

  console.log(
    `\nConnecting to ${host}:${port}${authExercised ? ' and authenticating' : ' (AUTH skipped by config)'}…`,
  );
  try {
    await transporter.verify();
    console.log(`  connect + TLS${authExercised ? ' + AUTH' : ''}: OK`);
  } catch (error) {
    console.log('  connect + TLS + AUTH: FAILED');
    console.log(`\n  ${explain(error)}`);
    console.log(`\n  raw: ${(error as Error).message}`);
    console.log('\nRESULT: FAIL');
    process.exit(1);
  }

  if (!authExercised && !isLoopbackSmtpSink) {
    console.log(
      '\n  The credentials were NEVER SENT — this run proved only that the host is reachable.',
    );
    console.log('\nRESULT: FAIL — fix the configuration problem above, then re-run.');
    process.exit(1);
  }

  if (!sendTo) {
    console.log('\nRESULT: PASS — the transport accepts these credentials.');
    console.log(
      'No message was sent. Re-run with `--send <address>` to prove end-to-end delivery.',
    );
    console.log(
      'NOTE: AUTH passing does not guarantee delivery — a suspended account can authenticate and still refuse every recipient.',
    );
    return;
  }

  console.log(`\nSending a test message to ${maskEmail(sendTo)}…`);
  try {
    const info = await transporter.sendMail({
      from: `"Theraptly SMTP diagnostic" <${user}>`,
      to: sendTo,
      subject: `SMTP diagnostic — ${new Date().toISOString()}`,
      text: `Sent by scripts/test-smtp.ts from host ${host}:${port}.\nIf you are reading this, outbound mail works.`,
    });
    console.log(`  accepted: ${info.accepted.length}  rejected: ${info.rejected.length}`);
    console.log(`  messageId: ${info.messageId}`);
    console.log(`  server response: ${info.response}`);

    if (info.rejected.length > 0) {
      console.log('\nRESULT: FAIL — the server authenticated but refused the recipient.');
      process.exit(1);
    }
    console.log('\nRESULT: PASS — message accepted for delivery. Confirm it arrives in the inbox.');
  } catch (error) {
    console.log('  send: FAILED');
    console.log(`\n  ${explain(error)}`);
    console.log(`\n  raw: ${(error as Error).message}`);
    console.log('\nRESULT: FAIL');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Diagnostic crashed:', error);
  process.exit(1);
});
