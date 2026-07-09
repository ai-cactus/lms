/**
 * E2E spec: Invite modal — role selector shows correct grantable roles per inviter.
 *
 * Acceptance criteria:
 *   - An 'owner' or 'supervisor' sees the full grantable set in the role selector:
 *       supervisor, hr, clinical_director, finance, + all 8 job-specific worker
 *       roles (e.g. Nurse, Case Manager, ...)
 *     but NOT 'owner' (non-grantable).
 *   - An 'hr' inviter sees: hr, clinical_director, finance, + all 8 worker roles
 *     but NOT 'supervisor' or 'owner'.
 *   - 'owner' never appears as an option in any inviter's role selector.
 *
 * Note: the single 'worker' role was replaced by 8 job-specific worker-category
 * roles (see src/lib/rbac/permissions.ts); the role selector shows each by its
 * own `displayName` (e.g. "Nurse", "Case Manager") rather than a generic
 * "Worker" label, so assertions target specific worker displayNames.
 *
 * IMPORTANT — modal is now a 2-step flow (staff-invite rewrite): opening the
 * modal lands on the "Invite New Staffs" email-entry step, which has NO role
 * selector at all. The role picker only appears on step 2 ("Assign roles"),
 * reached by typing/pasting at least one valid email and clicking "Continue".
 * `loginAndOpenInviteModal` below performs that email → Continue hop before
 * returning, so callers land directly on the Assign-roles step. The full
 * submit → success path (createInvites actually firing) is covered separately
 * in tests/e2e/staff-invite-flow.spec.ts; this spec only asserts the grant
 * matrix visible in the role dropdown.
 *
 * Flow:
 *   1. Seed a test user with the target inviter role.
 *   2. Log in as that user.
 *   3. Navigate to /dashboard/staff (the invite-staff page).
 *   4. Open the invite modal, enter one email, click Continue to reach step 2.
 *   5. Open the "Set every role to" bulk selector and assert its options match
 *      the expected GRANTABLE_ROLES matrix.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - DATABASE_URL reachable for seeding.
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// ── DB helpers ────────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

type Role =
  | 'owner'
  | 'supervisor'
  | 'hr'
  | 'clinical_director'
  | 'finance'
  | 'psychiatrist_prescriber'
  | 'nurse'
  | 'therapist_clinician'
  | 'case_manager'
  | 'behavioral_health_technician'
  | 'peer_support_specialist'
  | 'front_desk_admin'
  | 'facilities_support';

interface Seeded {
  userId: string;
  orgId: string;
  facilityId: string;
}

async function seedInviter(role: Role, email: string, password: string): Promise<Seeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const hashed = await bcrypt.hash(password, 10);
    const slug = `invite-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Invite Test ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Invite Test ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4::\"UserRole\", true, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, role, orgId, facilityId],
    );
    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, email, 'Inv', 'Test', 'Inv Test'],
    );
    return { userId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM profiles WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.userId]);
    await client.query(`DELETE FROM facilities WHERE id = $1`, [seeded.facilityId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [seeded.orgId]);
  } finally {
    await client.end();
  }
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@invite-e2e.invalid`;
}

async function loginAndOpenInviteModal(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  // Give each login attempt a unique source IP so the in-memory rate-limit
  // bucket (login:${ip}) doesn't accumulate across tests when the dev server
  // is reused and Redis is unavailable.
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Generous timeout: against a dev server (Turbopack), the FIRST hit to a
  // given route/server-action across all parallel workers pays an on-demand
  // compile cost that can exceed several seconds under worker contention —
  // this is dev-only overhead (production is pre-compiled), not app latency.
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
  await page.goto('/dashboard/staff');
  await page.waitForLoadState('networkidle');
  // Open the invite modal — button label is "Add Workers" on the staff page.
  const inviteBtn = page.getByRole('button', { name: /add workers?/i }).first();
  await inviteBtn.click();
  // Wait for modal to appear (step 1 — email entry).
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

  // Step 1 → step 2: type a throwaway email and click Continue. The role
  // selector only exists on step 2 ("Assign roles").
  await page
    .getByPlaceholder(/enter emails separated by/i)
    .fill(`probe-${crypto.randomBytes(3).toString('hex')}@invite-e2e.invalid`);
  await page.getByRole('button', { name: /^continue$/i }).click();
  await expect(page.getByText('Assign roles')).toBeVisible({ timeout: 5000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Invite modal — role selector per inviter role', () => {
  test('owner sees supervisor, hr, clinical_director, finance, + all 8 worker roles — but NOT owner', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = uid('inv-owner');
    const seeded = await seedInviter('owner', email, 'Owne!r99xP');
    try {
      await loginAndOpenInviteModal(page, email, 'Owne!r99xP');

      // Open the role selector (shadcn Select / combobox)
      const select = page.getByRole('combobox').first();
      await select.click();

      // All grantable admin roles must be visible
      await expect(page.getByRole('option', { name: /supervisor/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /^hr$/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /clinical director/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /finance/i })).toBeVisible();

      // All 8 job-specific worker-category roles must be visible (by displayName)
      await expect(page.getByRole('option', { name: /psychiatrist.*prescriber/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /^nurse$/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /therapist.*clinician/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /case manager/i })).toBeVisible();
      await expect(
        page.getByRole('option', { name: /behavioral health technician/i }),
      ).toBeVisible();
      await expect(page.getByRole('option', { name: /peer support specialist/i })).toBeVisible();
      await expect(
        page.getByRole('option', { name: /front desk.*administrative support/i }),
      ).toBeVisible();
      await expect(page.getByRole('option', { name: /facilities.*support staff/i })).toBeVisible();

      // Owner must NOT be an option
      await expect(page.getByRole('option', { name: /^owner/i })).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr sees hr, clinical_director, finance, + all 8 worker roles — but NOT supervisor or owner', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = uid('inv-hr');
    const seeded = await seedInviter('hr', email, 'Hr!Pass99x');
    try {
      await loginAndOpenInviteModal(page, email, 'Hr!Pass99x');

      const select = page.getByRole('combobox').first();
      await select.click();

      // HR's grantable admin roles
      await expect(page.getByRole('option', { name: /^hr$/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /clinical director/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /finance/i })).toBeVisible();

      // HR can also grant all 8 job-specific worker-category roles
      await expect(page.getByRole('option', { name: /^nurse$/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /case manager/i })).toBeVisible();
      await expect(
        page.getByRole('option', { name: /front desk.*administrative support/i }),
      ).toBeVisible();

      // Supervisor and owner must NOT be options (D1)
      await expect(page.getByRole('option', { name: /supervisor/i })).not.toBeVisible();
      await expect(page.getByRole('option', { name: /^owner/i })).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});
