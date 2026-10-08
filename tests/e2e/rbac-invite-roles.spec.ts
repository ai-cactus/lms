/**
 * E2E spec: Invite modal — role selector shows correct grantable roles per inviter.
 *
 * Acceptance criteria — the role selector depends on the invite PATH chosen in the
 * Facility select, then on the inviter:
 *   - Global path: only the org-wide roles the inviter may grant. An 'owner' sees
 *     admin, hr, clinical_director, finance; an 'hr' sees the same minus admin
 *     (founder Q10 — HR may invite anyone except the two Owner-equivalent seats).
 *     No supervisor and no worker role is offered.
 *   - Facility path: supervisor + all 8 job-specific worker roles, for owner and
 *     hr alike; no hr, finance, clinical_director, admin or owner.
 *   - 'owner' never appears as an option on any path.
 *
 * Note: the single 'worker' role was replaced by 8 job-specific worker-category
 * roles (see src/lib/rbac/permissions.ts); the role selector shows each by its
 * own `displayName` (e.g. "Nurse", "Case Manager") rather than a generic
 * "Worker" label, so assertions target specific worker displayNames.
 *
 * IMPORTANT — modal is now a 2-step flow (staff-invite rewrite): opening the
 * modal lands on the "Invite New Staff" email-entry step, which has NO role
 * selector at all. The role picker only appears on step 2 ("Assign roles"),
 * reached by typing/pasting at least one valid email and clicking "Assign role".
 * `loginAndOpenInviteModal` below performs that email → "Assign role" hop before
 * returning, so callers land directly on the Assign-roles step. The full
 * submit → success path (createInvites actually firing) is covered separately
 * in tests/e2e/staff-invite-flow.spec.ts; this spec only asserts the grant
 * matrix visible in the role dropdown.
 *
 * Flow:
 *   1. Seed a test user with the target inviter role.
 *   2. Log in as that user.
 *   3. Navigate to /dashboard/staff (the invite-staff page).
 *   4. Open the invite modal, pick Global or the (single) facility, enter one email,
 *      click "Assign role" to reach step 2.
 *   5. Open the "Role to apply to everyone" bulk selector and assert its options match
 *      the expected set for that path.
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
  orgUserId: string;
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
    const orgUserId = crypto.randomUUID();

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
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, 'Inv', 'Test', 'Inv Test'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::\"UserRole\", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, orgId, role],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), orgUserId, facilityId],
    );
    return { userId, orgUserId, orgId, facilityId };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.orgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [seeded.orgUserId]);
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

type InvitePath = 'global' | 'facility';

async function loginAndOpenInviteModal(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  path: InvitePath,
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
  // Open the invite modal — button label is "Add Staff" on the staff page.
  const inviteBtn = page.getByRole('button', { name: /add staff/i }).first();
  await inviteBtn.click();
  // Wait for modal to appear (step 1 — email entry).
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

  // Step 1 → step 2: pick the invite path (required — "Assign role" is a no-op
  // without a facility choice), type a throwaway email, and click "Assign role".
  // The role selector only exists on step 2 ("Assign roles"), and what it offers
  // depends on the path: Global → org-wide roles, a facility → supervisor + workers.
  await page.getByRole('combobox', { name: 'Facility' }).click();
  await page
    .getByRole('option', { name: path === 'global' ? /^global/i : /^(?!global)/i })
    .first()
    .click();
  await page
    .getByPlaceholder(/enter emails separated by/i)
    .fill(`probe-${crypto.randomBytes(3).toString('hex')}@invite-e2e.invalid`);
  await page.getByRole('button', { name: /^assign role$/i }).click();
  // Exact heading match — the step-1 description paragraph ("...so you can
  // assign roles.") contains the same words and would otherwise satisfy a
  // loose getByText('Assign roles') even while still stuck on step 1.
  await expect(page.getByRole('heading', { name: 'Assign roles', exact: true })).toBeVisible({
    timeout: 5000,
  });
}

const WORKER_OPTION_NAMES = [
  /psychiatrist.*prescriber/i,
  /^nurse$/i,
  /therapist.*clinician/i,
  /case manager/i,
  /behavioral health technician/i,
  /peer support specialist/i,
  /front desk.*administrative support/i,
  /facilities.*support staff/i,
];

async function openBulkRoleSelect(page: import('@playwright/test').Page) {
  await page.getByRole('combobox', { name: 'Role to apply to everyone' }).click();
}

async function expectNoWorkerOrSupervisorOptions(page: import('@playwright/test').Page) {
  for (const name of WORKER_OPTION_NAMES) {
    await expect(page.getByRole('option', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('option', { name: /supervisor/i })).toHaveCount(0);
}

async function expectAllWorkerOptions(page: import('@playwright/test').Page) {
  for (const name of WORKER_OPTION_NAMES) {
    await expect(page.getByRole('option', { name })).toBeVisible();
  }
}

async function expectNoOrgWideOptions(page: import('@playwright/test').Page) {
  await expect(page.getByRole('option', { name: /^hr$/i })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /finance/i })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /clinical director/i })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /^admin$/i })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /^owner/i })).toHaveCount(0);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Invite modal — Global path: org-wide roles only', () => {
  test('owner under Global sees admin, hr, clinical_director, finance — and no supervisor, worker role or owner', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = uid('inv-owner-global');
    const seeded = await seedInviter('owner', email, 'Owne!r99xP');
    try {
      await loginAndOpenInviteModal(page, email, 'Owne!r99xP', 'global');
      await openBulkRoleSelect(page);

      await expect(page.getByRole('option', { name: /^admin$/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /^hr$/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /clinical director/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /finance/i })).toBeVisible();
      await expect(page.getByRole('option')).toHaveCount(4);

      await expectNoWorkerOrSupervisorOptions(page);
      await expect(page.getByRole('option', { name: /^owner/i })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr under Global sees hr, clinical_director, finance — the same set minus admin', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = uid('inv-hr-global');
    const seeded = await seedInviter('hr', email, 'Hr!Pass99x');
    try {
      await loginAndOpenInviteModal(page, email, 'Hr!Pass99x', 'global');
      await openBulkRoleSelect(page);

      await expect(page.getByRole('option', { name: /^hr$/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /clinical director/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /finance/i })).toBeVisible();
      await expect(page.getByRole('option')).toHaveCount(3);

      // The escalation fence: HR may never grant the two Owner-equivalent seats
      // (founder Q10, round 2). Losing either assertion is a privilege-escalation
      // regression.
      await expect(page.getByRole('option', { name: /^admin$/i })).toHaveCount(0);
      await expect(page.getByRole('option', { name: /^owner/i })).toHaveCount(0);
      await expectNoWorkerOrSupervisorOptions(page);
    } finally {
      await cleanup(seeded);
    }
  });

  test('worker roles are not offered under Global, in the bulk select or in a row select', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = uid('inv-global-no-workers');
    const seeded = await seedInviter('owner', email, 'Owne!r99xP');
    try {
      await loginAndOpenInviteModal(page, email, 'Owne!r99xP', 'global');

      await openBulkRoleSelect(page);
      await expectNoWorkerOrSupervisorOptions(page);
      await page.keyboard.press('Escape');

      await page.getByRole('combobox', { name: /^Role for probe-/ }).click();
      await expectNoWorkerOrSupervisorOptions(page);
      await expect(page.getByRole('option', { name: /^hr$/i })).toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Invite modal — facility path: supervisor + workers only', () => {
  test('owner under a facility sees supervisor + all 8 worker roles — and no hr, finance, clinical director, admin or owner', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = uid('inv-owner-fac');
    const seeded = await seedInviter('owner', email, 'Owne!r99xP');
    try {
      await loginAndOpenInviteModal(page, email, 'Owne!r99xP', 'facility');
      await openBulkRoleSelect(page);

      await expect(page.getByRole('option', { name: /facility supervisor/i })).toBeVisible();
      await expectAllWorkerOptions(page);
      await expect(page.getByRole('option')).toHaveCount(9);
      await expectNoOrgWideOptions(page);
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr under a facility sees the same supervisor + worker roles, and still no org-wide role', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = uid('inv-hr-fac');
    const seeded = await seedInviter('hr', email, 'Hr!Pass99x');
    try {
      await loginAndOpenInviteModal(page, email, 'Hr!Pass99x', 'facility');
      await openBulkRoleSelect(page);

      await expect(page.getByRole('option', { name: /facility supervisor/i })).toBeVisible();
      await expectAllWorkerOptions(page);
      await expect(page.getByRole('option')).toHaveCount(9);
      await expectNoOrgWideOptions(page);
    } finally {
      await cleanup(seeded);
    }
  });
});
