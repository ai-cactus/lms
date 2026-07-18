/**
 * E2E spec: 2FA email-OTP consolidation — the single-challenge login fix.
 *
 * Root cause: the old verify route decoded the session cookie with
 * NEXTAUTH_SECRET only. create-auth-instance.ts (which ENCRYPTS the cookie)
 * resolves the secret as `AUTH_SECRET || NEXTAUTH_SECRET`, so whenever
 * AUTH_SECRET was also set and differed from NEXTAUTH_SECRET — which is the
 * case in this environment (confirmed: the two env vars hold different
 * values here) — the decode silently failed, the `mfaVerified` stamp never
 * landed, and proxy.ts's step-up gate bounced the user to a SECOND
 * `/verify-2fa` challenge after they had already completed the first one.
 * `stampSessionMfaVerified()` (src/lib/auth/mfa-session-stamp.ts) now
 * resolves the secret with the same variable and the same order the encoder
 * uses, so running this spec against a real AUTH_SECRET != NEXTAUTH_SECRET
 * environment is a genuine regression test for the fix, not a masked pass.
 *
 * Also covered: Issue 1 (a wrong code must not consume the single-use
 * challenge — the correct code must still work on the SAME challenge
 * afterward), the /verify-2fa -> /login redirect (next.config.ts), and the
 * per-user OTP-send rate limit surfacing as a real UI error instead of a
 * false "code sent" (Issue 4).
 *
 * OTP retrieval: reads the rendered email straight from MailHog's HTTP API
 * (http://localhost:8025/api/v2) rather than decrypting the DB column
 * directly — this matches how a real user gets the code and avoids the
 * NEXTAUTH_SECRET-export requirement documented for the DB-decrypt approach
 * used elsewhere (see mfa-enrollment.spec.ts).
 */

import { test, expect, Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';
const MAILHOG_URL = process.env.MAILHOG_URL || 'http://localhost:8025';

// ── DB helpers ──────────────────────────────────────────────────────────────

async function dbClient(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

interface SeededUser {
  userId: string;
  email: string;
  password: string;
  organizationId: string;
  facilityId: string;
}

/** Mirrors mfa-enrollment.spec.ts's seedMfaTestUser: an org/facility-attached
 * owner with no 2FA yet, so the OrganizationActivationModal never interferes
 * with normal /dashboard/* navigation. */
async function seedTestUser(prefix: string, mfaEnabled = false): Promise<SeededUser> {
  const db = await dbClient();
  try {
    const email = `${prefix}-${crypto.randomBytes(4).toString('hex')}@mfa-consolidation-e2e.invalid`;
    const password = 'MfaConsolidationP@ss99';
    const hashed = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const slug = `mfa-consol-e2e-${crypto.randomBytes(4).toString('hex')}`;

    await db.query(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [organizationId, 'Mfa Consolidation E2E Org', slug],
    );
    await db.query(
      `INSERT INTO facilities (id, organization_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [facilityId, organizationId, 'Mfa Consolidation E2E Facility'],
    );
    await db.query(
      `INSERT INTO users (id, email, password, role, email_verified, mfa_enabled, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, $4, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, mfaEnabled, organizationId, facilityId],
    );
    await db.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Mfa', 'Consolidation', 'Mfa Consolidation'],
    );

    if (mfaEnabled) {
      // Placeholder secret — overwritten by the first real send. Just needs
      // to exist as a verified email factor so sendLoginMfaCode() finds it.
      await db.query(
        `INSERT INTO mfa_factors (id, user_id, type, secret, name, verified, created_at, updated_at)
         VALUES ($1, $2, 'email', 'placeholder', 'Email OTP', true, NOW(), NOW())`,
        [crypto.randomUUID(), userId],
      );
    }

    return { userId, email, password, organizationId, facilityId };
  } finally {
    await db.end();
  }
}

async function cleanupTestUser(seeded: SeededUser): Promise<void> {
  const db = await dbClient();
  try {
    await db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [seeded.userId]);
    await db.query(`DELETE FROM mfa_factors WHERE user_id = $1`, [seeded.userId]);
    await db.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await db.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await db.query(`DELETE FROM organizations WHERE id = $1`, [seeded.organizationId]);
  } finally {
    await db.end();
  }
}

// ── MailHog helpers ─────────────────────────────────────────────────────────

interface MailHogItem {
  ID: string;
  Content: { Headers: Record<string, string[]>; Body: string };
}

/** Undoes nodemailer's quoted-printable transfer encoding: soft line-break
 * removal + =XX hex-escape decoding. The OTP digits are plain ASCII so no
 * charset handling is needed beyond byte-for-byte hex substitution. */
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

async function searchMailHog(email: string): Promise<MailHogItem[]> {
  const res = await fetch(
    `${MAILHOG_URL}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`,
  );
  if (!res.ok) throw new Error(`MailHog search failed: ${res.status}`);
  const data = (await res.json()) as { items: MailHogItem[] };
  return data.items ?? [];
}

/**
 * Polls MailHog for a fresh "verification code" email to `email` whose
 * message ID is not in `excludeIds`, and extracts the 6-digit code. Multiple
 * OTP emails go to the same address across a spec (enrollment, then login
 * step-up), so previously-seen message IDs must be excluded rather than
 * relying on "most recent" alone if a poll straddles two sends.
 */
async function pollForOtpCode(
  email: string,
  excludeIds: Set<string>,
  timeoutMs = 20000,
): Promise<{ id: string; code: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const items = await searchMailHog(email);
    const fresh = items.find(
      (m) =>
        !excludeIds.has(m.ID) &&
        (m.Content.Headers['Subject']?.[0] ?? '').includes('verification code'),
    );
    if (fresh) {
      const decoded = decodeQuotedPrintable(fresh.Content.Body);
      const match = decoded.match(/\b(\d{6})\b/);
      if (match) return { id: fresh.ID, code: match[1] };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for an MFA OTP email to ${email}`);
}

function flipLastDigit(code: string): string {
  const last = code[code.length - 1];
  const flipped = last === '9' ? '0' : String(Number(last) + 1);
  return code.slice(0, -1) + flipped;
}

// ── Auth / UI helpers ────────────────────────────────────────────────────────

function randomIp(): string {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

async function login(page: Page, email: string, password: string, waitFor: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': randomIp() });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(waitFor, { timeout: 45000 });
}

async function fillOtpBoxes(page: Page, code: string) {
  for (let i = 0; i < code.length; i++) {
    await page.getByLabel(`Digit ${i + 1}`).fill(code[i]);
  }
}

function trackMainFrameNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe.serial('2FA consolidation: the money test — exactly one challenge, no /verify-2fa bounce', () => {
  let seeded: SeededUser;
  const seenMailHogIds = new Set<string>();

  test.beforeAll(async () => {
    seeded = await seedTestUser('mfa-money');
  });

  test.afterAll(async () => {
    await cleanupTestUser(seeded).catch(() => {});
  });

  test('enable 2FA, log out, log back in: single /mfa/verify challenge, wrong-then-right code, single redirect, /verify-2fa now dead', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // ── Enable 2FA ──────────────────────────────────────────────────────────
    await login(page, seeded.email, seeded.password, '**/dashboard**');
    await page.goto('/dashboard/profile');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /two factor auth/i }).click();
    await page.getByRole('button', { name: /set up 2fa/i }).click();
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({
      timeout: 15000,
    });

    const enrollmentOtp = await pollForOtpCode(seeded.email, seenMailHogIds);
    seenMailHogIds.add(enrollmentOtp.id);

    await page.getByPlaceholder('Enter code').fill(enrollmentOtp.code);
    await page.getByRole('button', { name: /enable 2fa/i }).click();
    await expect(page.getByRole('heading', { name: /save your recovery codes/i })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: /i have saved these codes/i }).click();
    await expect(page.getByText(/2fa is enabled on your theraptly account/i)).toBeVisible();

    // ── Log out fully (both admin/worker cookies) ──────────────────────────
    await page.goto('/api/auth/signout-all');
    await page.waitForURL('**/login**', { timeout: 15000 });

    // ── Log back in: track every main-frame navigation from here so we can
    // prove exactly one /mfa/verify challenge and zero /verify-2fa hits. ──
    const navigations = trackMainFrameNavigations(page);

    await page.setExtraHTTPHeaders({ 'x-forwarded-for': randomIp() });
    await page.goto('/login');
    await page.fill('input[type="email"]', seeded.email);
    await page.fill('input[type="password"]', seeded.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/mfa/verify**', { timeout: 45000 });
    await expect(page.getByRole('heading', { name: /two-factor authentication/i })).toBeVisible({
      timeout: 15000,
    });

    const mfaVerifyHits = navigations.filter((u) => u.includes('/mfa/verify'));
    expect(mfaVerifyHits, `navigations so far: ${navigations.join(', ')}`).toHaveLength(1);
    expect(navigations.some((u) => u.includes('/verify-2fa'))).toBe(false);

    // ── Wrong code first: must show an inline error, stay on /mfa/verify,
    // and leave the form usable (Issue 1 — the challenge is not burned). ──
    const loginOtp = await pollForOtpCode(seeded.email, seenMailHogIds);
    seenMailHogIds.add(loginOtp.id);

    const wrongCode = flipLastDigit(loginOtp.code);
    await fillOtpBoxes(page, wrongCode);
    await expect(page.getByText('Invalid verification code')).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain('/mfa/verify');
    await expect(page.getByLabel('Digit 1')).toBeEnabled();

    // ── Correct code on the SAME challenge now succeeds — single redirect,
    // no intermediate /verify-2fa. ──
    await fillOtpBoxes(page, loginOtp.code);
    await page.waitForURL('**/dashboard**', { timeout: 20000 });

    expect(navigations.some((u) => u.includes('/verify-2fa'))).toBe(false);
    const mfaVerifyHitsFinal = navigations.filter((u) => u.includes('/mfa/verify'));
    expect(mfaVerifyHitsFinal, `all navigations: ${navigations.join(', ')}`).toHaveLength(1);

    // ── The legacy step-up page is dead: a direct hit now bounces to /login. ──
    await page.goto('/verify-2fa');
    await page.waitForURL('**/login**', { timeout: 15000 });
    expect(page.url()).toContain('/login');
  });
});

test.describe('2FA consolidation: OTP send rate limit surfaces as a real UI error (Issue 4)', () => {
  let seeded: SeededUser;

  test.beforeAll(async () => {
    seeded = await seedTestUser('mfa-ratelimit', true);
  });

  test.afterAll(async () => {
    await cleanupTestUser(seeded).catch(() => {});
  });

  test('exhausting the 3-per-15-min send budget shows "Too many code requests", not a false success', async ({
    page,
  }) => {
    // CI (and any env with E2E_TEST_BYPASS_RATE_LIMIT=true) globally bypasses
    // the rate limiter, so the mfa-send budget can never be exhausted here and
    // the "Too many code requests" branch never fires. This flow is covered at
    // the unit level (send route returns 429; /mfa/verify surfaces the error);
    // run this end-to-end assertion only where rate limiting is actually live.
    test.skip(
      process.env.E2E_TEST_BYPASS_RATE_LIMIT === 'true',
      'MFA send rate limiting is bypassed in this environment',
    );
    test.setTimeout(60_000);

    const ip = randomIp();
    await login(page, seeded.email, seeded.password, '**/mfa/verify**');
    await expect(page.getByRole('heading', { name: /two-factor authentication/i })).toBeVisible({
      timeout: 15000,
    });

    const url = new URL(page.url());
    const challenge = url.searchParams.get('challenge');
    expect(challenge).toBeTruthy();

    // The page's on-mount effect already fired send #1. Fire #2 and #3
    // directly against the API (bypassing the UI's 60s resend cooldown) so
    // the budget (3 per 15 min) is exhausted without a real-time wait.
    for (let i = 0; i < 2; i++) {
      const res = await page.request.post('/api/auth/mfa/send', {
        headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
        data: { challenge },
      });
      expect(res.ok()).toBe(true);
    }

    // Reload re-runs the mount effect, driving send #4 through the REAL
    // component code path — this is the one that must surface the error in
    // the UI, not just return a 429 to a bare fetch.
    await page.reload();
    await expect(page.getByRole('heading', { name: /two-factor authentication/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Too many code requests. Please try again later.')).toBeVisible({
      timeout: 15000,
    });
  });
});
