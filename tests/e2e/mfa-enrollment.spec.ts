/**
 * E2E spec: THER-016 (MFA enroll 500) — email OTP enrollment + login step-up.
 *
 * Bug: verifyMfaSetup()/regenerateRecoveryCodes() ran 10 bcryptjs cost-12
 * hashes INSIDE prisma.$transaction, exceeding the 5s interactive-transaction
 * timeout on slow hosts and throwing unhandled — a 500 on a VALID code. Fix:
 * hashing moved outside the transaction; the transaction is wrapped in
 * try/catch returning a typed { success:false, error } instead of throwing.
 *
 * Journey under test (src/components/dashboard/TwoFactorAuthTab.tsx, rendered
 * on the "TWO FACTOR AUTH (2FA)" tab at /dashboard/profile):
 *   1. An admin-tier user with no 2FA set up requests an email OTP.
 *   2. A wrong code shows a clean, specific error (not a crash) and stays in
 *      setup mode.
 *   3. The real code enables 2FA and returns exactly 10 recovery codes, with
 *      no 500/unexpected-error surfaced (THER-016 regression guard).
 *   4. Logging back in with MFA enabled redirects to /mfa/verify?challenge=...
 *      (src/app/actions/auth.ts's authenticate() mints a Redis-backed
 *      challenge and routes signIn's redirectTo there — this is the live
 *      login step-up flow; /verify-2fa is a separate proxy.ts-driven gate for
 *      sessions that already exist when MFA becomes required mid-session). A
 *      fresh code is sent automatically on mount and completing it reaches
 *      /dashboard.
 *
 * Test isolation: uses a brand-new throwaway user seeded directly in the DB,
 * WITH an organization/facility already attached (not a shared
 * prisma/seed.ts account like admin@test.com), so enabling MFA here cannot
 * break any other spec's login flow, and the org-less-admin
 * OrganizationActivationModal (which blocks/redirects org-less dashboard
 * visits) never interferes. The user, its org/facility, and its
 * mfa_factors/mfa_recovery_codes rows are all deleted in afterAll.
 *
 * OTP retrieval: reads the `mfa_factors.secret` column directly via `pg` and
 * decrypts it client-side with the same AES-256-GCM scheme as src/lib/mfa.ts
 * (key = sha256(NEXTAUTH_SECRET); payload = iv(12) + authTag(16) + ciphertext,
 * base64-encoded). Requires NEXTAUTH_SECRET to be exported in the shell
 * running Playwright, matching the dev server's — see the e2e local runbook
 * (mirror the CI e2e job's env block from .github/workflows/ci.yml).
 */

import { test, expect, Page } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

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

/**
 * Seeds a throwaway owner WITH an organization/facility already attached.
 *
 * An org-less admin gets the app-wide "Activate your account"
 * OrganizationActivationModal (src/components/dashboard/OrganizationActivationModal.tsx)
 * on every /dashboard/* page — it suppresses outside-click/Escape dismissal in
 * welcome mode and auto-navigates to /onboarding after 60s. That's correct
 * product behavior, but it's orthogonal to what this spec exercises (2FA
 * enrollment), so the seed gives the user an org/facility up front —
 * mirroring a real admin who has already onboarded.
 */
async function seedMfaTestUser(): Promise<SeededUser> {
  const db = await dbClient();
  try {
    const email = `mfa-e2e-${crypto.randomBytes(4).toString('hex')}@mfa-e2e.invalid`;
    const password = 'MfaE2eP@ssw0rd99';
    const hashed = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const slug = `mfa-e2e-${crypto.randomBytes(4).toString('hex')}`;

    await db.query(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [organizationId, 'Mfa E2E Org', slug],
    );
    await db.query(
      `INSERT INTO facilities (id, organization_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [facilityId, organizationId, 'Mfa E2E Facility'],
    );
    await db.query(
      `INSERT INTO users (id, email, password, role, email_verified, mfa_enabled, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'owner'::"UserRole", true, false, $4, $5, NOW(), NOW())`,
      [userId, email, hashed, organizationId, facilityId],
    );
    await db.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Mfa', 'Enrollee', 'Mfa Enrollee'],
    );
    return { userId, email, password, organizationId, facilityId };
  } finally {
    await db.end();
  }
}

async function cleanupMfaTestUser(seeded: SeededUser): Promise<void> {
  const db = await dbClient();
  try {
    await db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [seeded.userId]);
    await db.query(`DELETE FROM mfa_factors WHERE user_id = $1`, [seeded.userId]);
    await db.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    // users -> organizations/facilities are onDelete: Restrict — the user row
    // must be gone before the org/facility it points to can be deleted.
    await db.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await db.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await db.query(`DELETE FROM organizations WHERE id = $1`, [seeded.organizationId]);
  } finally {
    await db.end();
  }
}

/** Reads the current email-factor secret (there is only ever one row — see
 * mfa.ts: enrollment/login OTP sends all update the same MfaFactor row). */
async function getEmailFactorSecret(userId: string): Promise<string | null> {
  const db = await dbClient();
  try {
    const res = await db.query(
      `SELECT secret FROM mfa_factors WHERE user_id = $1 AND type = 'email'
        ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    );
    return res.rows[0]?.secret ?? null;
  } finally {
    await db.end();
  }
}

/**
 * Polls until an mfa_factors.secret value appears that differs from
 * `excludeSecret`. The same row is reused (and overwritten in place) by every
 * OTP send — enrollment, resend, and the login step-up's auto-send all update
 * the one row — so without excluding the previously-known value, a poll right
 * after a fresh send could still read the stale secret from before that send
 * completed.
 */
async function pollForEmailFactorSecret(
  userId: string,
  excludeSecret?: string,
  timeoutMs = 8000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const secret = await getEmailFactorSecret(userId);
    if (secret && secret !== excludeSecret) return secret;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for a fresh mfa_factors secret for user ${userId}`);
}

// ── OTP decryption — mirrors src/lib/mfa.ts's decryptSecret/decryptOtpPayload ──

function getMfaEncryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      'NEXTAUTH_SECRET must be exported (matching the dev server) to decrypt MFA OTPs in this spec — see the e2e local runbook.',
    );
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function decryptMfaOtp(encoded: string): { code: string; createdAt: number } {
  const key = getMfaEncryptionKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  const raw = decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
  return JSON.parse(raw) as { code: string; createdAt: number };
}

function flipLastDigit(code: string): string {
  const last = code[code.length - 1];
  const flipped = last === '9' ? '0' : String(Number(last) + 1);
  return code.slice(0, -1) + flipped;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function login(page: Page, email: string, password: string) {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
}

/** Same as login(), but for an account with MFA enabled. src/app/actions/auth.ts's
 * authenticate() mints a Redis-backed MFA challenge and passes it as signIn's
 * redirectTo, so a successful credentials login lands on
 * /mfa/verify?challenge=... instead of /dashboard. */
async function loginExpectingMfaChallenge(page: Page, email: string, password: string) {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/mfa/verify**', { timeout: 45000 });
}

async function fillOtpBoxes(page: Page, code: string) {
  for (let i = 0; i < code.length; i++) {
    await page.getByLabel(`Digit ${i + 1}`).fill(code[i]);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe.serial('THER-016: MFA email enrollment + login step-up', () => {
  let seeded: SeededUser;
  // The single mfa_factors row's secret as of the end of enrollment — used to
  // detect the login step-up's fresh send rather than re-reading the stale
  // enrollment-time value (see pollForEmailFactorSecret's doc comment).
  let enrollmentSecret: string;

  test.beforeAll(async () => {
    seeded = await seedMfaTestUser();
  });

  test.afterAll(async () => {
    await cleanupMfaTestUser(seeded).catch(() => {});
  });

  test('enrollment: a wrong code errors cleanly, then the real code enables 2FA with 10 recovery codes (no 500)', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await login(page, seeded.email, seeded.password);
    await page.goto('/dashboard/profile');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /two factor auth/i }).click();
    await page.getByRole('button', { name: /set up 2fa/i }).click();

    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({
      timeout: 15000,
    });

    const secret = await pollForEmailFactorSecret(seeded.userId);
    enrollmentSecret = secret;
    const { code: realCode } = decryptMfaOtp(secret);
    expect(realCode).toMatch(/^\d{6}$/);

    // Wrong code first — must show the specific enrollment error, not crash.
    const wrongCode = flipLastDigit(realCode);
    await page.getByPlaceholder('Enter code').fill(wrongCode);
    await page.getByRole('button', { name: /enable 2fa/i }).click();
    await expect(
      page.getByText('Invalid verification code. Please try again.'),
    ).toBeVisible({ timeout: 10000 });
    // Still in setup mode — 2FA was not enabled by the wrong code.
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();

    // Now the real code — THER-016's regression path (this used to 500).
    await page.getByPlaceholder('Enter code').fill(realCode);
    await page.getByRole('button', { name: /enable 2fa/i }).click();

    await expect(page.getByRole('heading', { name: /save your recovery codes/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('code')).toHaveCount(10);

    await page.getByRole('button', { name: /i have saved these codes/i }).click();
    await expect(page.getByText(/2fa is enabled on your theraptly account/i)).toBeVisible();
  });

  test('step-up: the next login is redirected to /mfa/verify and a fresh code completes it', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // Full logout — clears both admin/worker session cookies (see
    // src/app/api/auth/signout-all/route.ts).
    await page.goto('/api/auth/signout-all');
    await page.waitForURL('**/login**', { timeout: 15000 });

    await loginExpectingMfaChallenge(page, seeded.email, seeded.password);
    await expect(page.getByRole('heading', { name: /two-factor authentication/i })).toBeVisible({
      timeout: 15000,
    });

    // The page auto-sends a fresh OTP on mount (POST /api/auth/mfa/send →
    // sendLoginMfaCode), overwriting the same mfa_factors row used during
    // enrollment — poll for a value that differs from the enrollment-time
    // secret so a slow send can't be raced.
    const secret = await pollForEmailFactorSecret(seeded.userId, enrollmentSecret);
    const { code: freshCode } = decryptMfaOtp(secret);
    expect(freshCode).toMatch(/^\d{6}$/);

    await fillOtpBoxes(page, freshCode);
    // The last digit auto-submits (OtpInput's onComplete) — no button click needed.

    await page.waitForURL('**/dashboard**', { timeout: 20000 });
  });
});
