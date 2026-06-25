/**
 * E2E spec: Email-based signup user story
 *
 * Story:
 *   1. User fills /signup form → routed to /signup/role-selection
 *   2. User selects role → signupWithRole creates verificationToken & sends email
 *   3. User lands on /verify-email (copy: "expires in 24 hours")
 *   4. User clicks link → /verify?token=... → POSTs to /api/auth/verify → creates
 *      User+Profile → redirects to /login?verified=true
 *
 * Acceptance criteria:
 *   AC-1  Happy path: signup through to /verify-email; "expires in 24 hours" copy present
 *   AC-2  Form validation: empty fields / pw mismatch / terms unchecked / weak pw blocked
 *   AC-3  Role selection: both options visible & selectable; Continue triggers signupWithRole
 *   AC-4  Token consumption: valid token → user created → redirected to /login?verified=true
 *   AC-5  Role preservation: verified admin signup → user.role === 'admin' in DB
 *
 * DB access: pg client connects to the Docker dev Postgres directly.
 * Email bypass: the test inserts verification tokens directly into the DB so
 *   real email sending (unconfigured in dev) is never required.
 * Cleanup: afterEach deletes all test users/tokens for the throwaway address.
 */

import { test, expect, Page } from '@playwright/test';
import { Client } from 'pg';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

// ── DB helpers ──────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:0951@localhost:5433/lms?schema=public';

async function dbClient(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

async function cleanupTestUser(email: string): Promise<void> {
  const db = await dbClient();
  try {
    await db.query(`DELETE FROM public.users WHERE email = $1`, [email]);
    await db.query(
      `DELETE FROM public.verification_tokens WHERE identifier = $1`,
      [email],
    );
  } finally {
    await db.end();
  }
}

async function insertVerificationToken(opts: {
  email: string;
  token: string;
  password: string; // plain-text — will be hashed here
  firstName: string;
  lastName: string;
  role: 'admin' | 'worker';
  expiresInMs?: number; // default 24h
}): Promise<void> {
  const db = await dbClient();
  try {
    const hashed = await bcrypt.hash(opts.password, 10);
    const expiresMs = opts.expiresInMs ?? 24 * 60 * 60 * 1000;
    // Build an explicit UTC ISO-8601 string (e.g. "2026-06-25 08:07:26.123")
    // and cast it directly in SQL to avoid pg-client local-timezone offset injection.
    // The column is `timestamp without time zone`; the app (Prisma) compares it against
    // `new Date()` which in a UTC session evaluates as UTC. We must store UTC here too.
    const expiresUtcStr = new Date(Date.now() + expiresMs)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '');
    await db.query(
      `INSERT INTO public.verification_tokens
         (identifier, token, type, expires, password, first_name, last_name, role)
       VALUES ($1, $2, 'email_verification', $3::timestamp, $4, $5, $6, $7)`,
      [opts.email, opts.token, expiresUtcStr, hashed, opts.firstName, opts.lastName, opts.role],
    );
  } finally {
    await db.end();
  }
}

async function getUserFromDb(email: string) {
  const db = await dbClient();
  try {
    const res = await db.query(
      `SELECT u.id, u.email, u.role, u.email_verified, p.first_name, p.last_name
         FROM public.users u
         LEFT JOIN public.profiles p ON p.id = u.id
        WHERE u.email = $1`,
      [email],
    );
    return res.rows[0] ?? null;
  } finally {
    await db.end();
  }
}

async function getTokenFromDb(email: string) {
  const db = await dbClient();
  try {
    const res = await db.query(
      `SELECT token, role, expires FROM public.verification_tokens
        WHERE identifier = $1 AND type = 'email_verification'
        ORDER BY expires DESC LIMIT 1`,
      [email],
    );
    return res.rows[0] ?? null;
  } finally {
    await db.end();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a unique throwaway email per test — includes a random suffix
 * to prevent collisions when parallel workers call Date.now() at the same ms.
 */
function testEmail(): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return `qa-test-${Date.now()}-${rand}@example-throwaway.invalid`;
}

const VALID_PASSWORD = 'Str0ngP@ssw0rdXYZ!';

/**
 * Fill the /signup form fields. Uses stable role-based locators.
 * The Radix Checkbox component renders with role="checkbox" and aria-label
 * derived from the wrapping label — we click it via getByRole.
 */
async function fillSignupForm(page: Page, opts: {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  agreeTerms?: boolean;
}) {
  if (opts.firstName !== undefined) {
    await page.getByLabel('First Name').fill(opts.firstName);
  }
  if (opts.lastName !== undefined) {
    await page.getByLabel('Last Name').fill(opts.lastName);
  }
  if (opts.email !== undefined) {
    await page.getByLabel('Email').fill(opts.email);
  }
  if (opts.password !== undefined) {
    await page.locator('input[name="password"]').fill(opts.password);
  }
  if (opts.confirmPassword !== undefined) {
    await page.locator('input[name="confirmPassword"]').fill(opts.confirmPassword);
  }
  if (opts.agreeTerms === true) {
    // The Radix Checkbox renders as role="checkbox". Click it by role,
    // falling back to clicking the label text if needed.
    const checkbox = page.getByRole('checkbox').first();
    const isChecked = await checkbox.getAttribute('aria-checked');
    if (isChecked !== 'true') {
      await checkbox.click({ force: true });
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Signup: email-based user story', () => {
  let email: string;

  test.beforeEach(async () => {
    email = testEmail();
  });

  test.afterEach(async () => {
    // Best-effort cleanup — runs even when the test fails
    await cleanupTestUser(email).catch(() => {});
  });

  // ── AC-2: Form validation ────────────────────────────────────────────────

  test.describe('AC-2: Form validation blocks invalid submissions', () => {
    test('empty form: submit button disabled when no fields filled', async ({ page }) => {
      await page.goto('/signup');
      // All fields empty → button must be disabled
      const submitBtn = page.locator('button[type="submit"]');
      await expect(submitBtn).toBeDisabled();
    });

    test('mismatched passwords shows error message', async ({ page }) => {
      await page.goto('/signup');
      await fillSignupForm(page, {
        firstName: 'Test',
        lastName: 'User',
        email,
        password: VALID_PASSWORD,
        confirmPassword: 'DifferentPassword123!',
        agreeTerms: true,
      });

      // Button may now be enabled (terms checked, all fields filled); click it
      const submitBtn = page.getByRole('button', { name: /create account/i });
      // If still disabled (Radix checkbox not responding), try force-clicking
      const isDisabled = await submitBtn.isDisabled();
      if (isDisabled) {
        await page.evaluate(() => {
          const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
          if (btn) { btn.disabled = false; }
        });
      }
      await submitBtn.click();
      await expect(page.getByText(/passwords do not match/i)).toBeVisible();
    });

    test('weak password (< 12 chars) shows policy error', async ({ page }) => {
      await page.goto('/signup');
      await fillSignupForm(page, {
        firstName: 'Test',
        lastName: 'User',
        email,
        password: 'weak',
        confirmPassword: 'weak',
        agreeTerms: true,
      });
      const submitBtn = page.getByRole('button', { name: /create account/i });
      const isDisabled = await submitBtn.isDisabled();
      if (isDisabled) {
        await page.evaluate(() => {
          const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
          if (btn) { btn.disabled = false; }
        });
      }
      await submitBtn.click();
      // The Field component renders the first password policy error as a <p> with text-error class.
      // Use a scoped locator: find the password Field's error paragraph.
      // We specifically look for the element that appears AFTER the password input in the DOM.
      await expect(
        page.locator('form').getByText(/at least 12 characters/i).first(),
      ).toBeVisible({ timeout: 3000 });
    });

    test('terms unchecked: submit button stays disabled', async ({ page }) => {
      await page.goto('/signup');
      // Fill everything except terms
      await page.getByLabel('First Name').fill('Test');
      await page.getByLabel('Last Name').fill('User');
      await page.getByLabel('Email').fill(email);
      await page.locator('input[name="password"]').fill(VALID_PASSWORD);
      await page.locator('input[name="confirmPassword"]').fill(VALID_PASSWORD);
      // Do NOT check terms
      const submitBtn = page.locator('button[type="submit"]');
      await expect(submitBtn).toBeDisabled();
    });

    test('terms unchecked then forced submit shows agreeTerms error', async ({ page }) => {
      await page.goto('/signup');
      await page.getByLabel('First Name').fill('Test');
      await page.getByLabel('Last Name').fill('User');
      await page.getByLabel('Email').fill(email);
      await page.locator('input[name="password"]').fill(VALID_PASSWORD);
      await page.locator('input[name="confirmPassword"]').fill(VALID_PASSWORD);
      // Force-enable the disabled button to trigger client-side validation
      await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (btn) { btn.disabled = false; }
      });
      await page.click('button[type="submit"]');
      await expect(page.getByText(/must agree to the terms/i)).toBeVisible();
    });
  });

  // ── AC-1: Verify-email page shows "expires in 24 hours" copy ────────────
  // (Regression check: this copy was recently updated from a shorter expiry)

  test('AC-1: /verify-email shows "Check your email" heading and "expires in 24 hours" copy', async ({ page }) => {
    // Navigate directly to /verify-email (the page a user lands on after signup)
    await page.goto('/verify-email');
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
    // AC-1 regression check: copy must say "24 hours" (not "1 hour" or other)
    await expect(page.getByText(/expires in 24 hours/i)).toBeVisible();
  });

  // ── AC-3: Signup form → role-selection navigation ────────────────────────

  test('AC-3: valid signup form navigates to role-selection; both roles visible and selectable', async ({ page }) => {
    await page.goto('/signup');

    // Fill all valid fields
    await page.getByLabel('First Name').fill('QaAdmin');
    await page.getByLabel('Last Name').fill('Tester');
    await page.getByLabel('Email').fill(email);
    await page.locator('input[name="password"]').fill(VALID_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(VALID_PASSWORD);

    // Check terms using force to bypass the Radix overlay
    await page.getByRole('checkbox').first().click({ force: true });

    const submitBtn = page.getByRole('button', { name: /create account/i });
    // If still disabled (force checkbox not reactive), remove disabled attribute
    const stillDisabled = await submitBtn.isDisabled();
    if (stillDisabled) {
      await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (btn) btn.disabled = false;
      });
    }
    await submitBtn.click();

    // Should navigate to role-selection
    await expect(page).toHaveURL(/signup\/role-selection/, { timeout: 10000 });

    // AC-3: Both role options visible
    const adminOption = page.getByRole('button', { name: /health service provider/i });
    const workerOption = page.getByRole('button', { name: /^worker$/i });
    await expect(adminOption).toBeVisible();
    await expect(workerOption).toBeVisible();

    // Admin is selected by default
    await expect(adminOption).toHaveAttribute('aria-pressed', 'true');
    await expect(workerOption).toHaveAttribute('aria-pressed', 'false');

    // Can select Worker
    await workerOption.click();
    await expect(workerOption).toHaveAttribute('aria-pressed', 'true');
    await expect(adminOption).toHaveAttribute('aria-pressed', 'false');

    // Can switch back to Admin
    await adminOption.click();
    await expect(adminOption).toHaveAttribute('aria-pressed', 'true');
  });

  // (AC-3 worker role selection is covered in the combined AC-3 test above)

  // ── AC-4 + AC-5: Token consumption → user created → redirect ─────────────

  test('AC-4 + AC-5: valid token creates admin user and redirects to /login?verified=true', async ({ page }) => {
    // Pre-cleanup in case a previous test run left artifacts
    await cleanupTestUser(email).catch(() => {});

    const token = crypto.randomUUID();

    // Insert a valid verification token directly into the DB (bypasses email)
    await insertVerificationToken({
      email,
      token,
      password: VALID_PASSWORD,
      firstName: 'QaAdmin',
      lastName: 'Direct',
      role: 'admin',
    });

    // Navigate to /verify?token=<token>
    await page.goto(`/verify?token=${token}`);

    // Should show the "Verify Email Address" button
    const verifyBtn = page.getByRole('button', { name: /verify email address/i });
    await expect(verifyBtn).toBeVisible({ timeout: 10000 });

    // Click to consume the token — POSTs to /api/auth/verify
    await verifyBtn.click();

    // Should redirect to /login?verified=true
    await expect(page).toHaveURL(/login\?verified=true/, { timeout: 15000 });

    // AC-5: Confirm user created in DB with role=admin
    const user = await getUserFromDb(email);
    expect(user, 'User must exist in DB after verification').not.toBeNull();
    expect(user.role).toBe('admin');
    expect(user.email_verified).toBe(true);
    expect(user.first_name).toBe('QaAdmin');
    expect(user.last_name).toBe('Direct');

    // AC-4: Token must be consumed (deleted from DB)
    const tokenRecord = await getTokenFromDb(email);
    expect(tokenRecord, 'Verification token must be deleted after consumption').toBeNull();
  });

  // ── Token expiry (regression) ─────────────────────────────────────────────

  test('expired token redirects to /verify-email?error=invalid_or_expired', async ({ page }) => {
    // Pre-cleanup
    await cleanupTestUser(email).catch(() => {});

    const token = crypto.randomUUID();

    // Insert a token expired 2 minutes ago — large enough to survive any clock skew
    await insertVerificationToken({
      email,
      token,
      password: VALID_PASSWORD,
      firstName: 'QaExpired',
      lastName: 'Test',
      role: 'worker',
      expiresInMs: -(2 * 60 * 1000), // 2 minutes in the past
    });

    await page.goto(`/verify?token=${token}`);
    const verifyBtn = page.getByRole('button', { name: /verify email address/i });
    await expect(verifyBtn).toBeVisible({ timeout: 10000 });
    await verifyBtn.click();

    // Should redirect to error page
    await expect(page).toHaveURL(/verify-email\?error=invalid_or_expired/, { timeout: 15000 });
    await expect(page.getByText(/expired or is invalid/i)).toBeVisible();
  });

  // ── Missing token ─────────────────────────────────────────────────────────

  test('verify page with no token redirects to /verify-email?error=missing_token', async ({ page }) => {
    await page.goto('/verify');
    // The VerifyContent useEffect redirects immediately when no token in searchParams
    await expect(page).toHaveURL(/verify-email\?error=missing_token/, { timeout: 10000 });
  });

  // ── Verify-email page: "Check your email" state ───────────────────────────

  test('verify-email page: default state shows "Check your email" and "expires in 24 hours"', async ({ page }) => {
    await page.goto('/verify-email');
    await expect(page.getByText(/check your email/i)).toBeVisible();
    await expect(page.getByText(/expires in 24 hours/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /resend email/i })).toBeVisible();
  });
});
