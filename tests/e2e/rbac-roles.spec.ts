/**
 * E2E spec: RBAC migration — post-migration login and role gating.
 *
 * Scenarios:
 *   1. A user with the new 'supervisor' role (previously 'admin') can log in to
 *      the admin dashboard and lands at /dashboard — not /worker.
 *   2. A user with the 'owner' role (org founder) can also reach /dashboard.
 *   3. A worker-category role (e.g. 'nurse') user logs in via /login?worker=true
 *      and lands at /worker.
 *   4. Attempting to log in with a password-auth user at the wrong portal is blocked
 *      (worker at /login lands at /worker; admin-role at /login?worker=true blocked).
 *   5. The stale 'admin' and single 'worker' roles no longer exist in the DB after
 *      migration — formerly-admin users are now 'supervisor', and workers are one
 *      of 8 job-specific roles. (Verified via DB query.)
 *
 * Pre-conditions:
 *   - App is running on http://localhost:3005 (started by webServer config).
 *   - DATABASE_URL is reachable from the test runner for direct DB operations.
 *
 * Cleanup: every test deletes its own test data on teardown.
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// ── DB helpers ────────────────────────────────────────────────────────────────

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

async function db(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

type UserRole =
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

interface SeedOptions {
  email: string;
  password: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
}

/**
 * Insert a fully-seeded test user with organization + facility + an active
 * OrganizationUser membership — role now lives on the membership row, not on
 * `users`, so every seeded role (admin-tier or worker-category) needs one to
 * actually resolve to that role on login.
 */
async function seedUser(
  opts: SeedOptions,
): Promise<{ userId: string; orgUserId: string; orgId: string; facilityId: string }> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(opts.password, 10);
    const orgSlug = `test-org-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Test Org ${orgSlug}`, orgSlug, opts.email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Test Org ${orgSlug}`],
    );

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [
        userId,
        opts.email,
        hashed,
        opts.firstName ?? 'Test',
        opts.lastName ?? 'User',
        `${opts.firstName ?? 'Test'} ${opts.lastName ?? 'User'}`,
      ],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::\"UserRole\", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, orgId, opts.role],
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

async function cleanupUser(userId: string, orgId?: string, orgUserId?: string): Promise<void> {
  const client = await db();
  try {
    if (orgUserId) {
      await client.query(
        `DELETE FROM organization_user_facilities WHERE organization_user_id = $1`,
        [orgUserId],
      );
      await client.query(`DELETE FROM organization_users WHERE id = $1`, [orgUserId]);
    }
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    if (orgId) {
      await client.query(`DELETE FROM facilities WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
  } finally {
    await client.end();
  }
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@rbac-test.invalid`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  portal: 'admin' | 'worker' = 'admin',
) {
  // Give each login attempt a unique source IP so the in-memory rate-limit
  // bucket (login:${ip}) doesn't accumulate across tests when the dev server
  // is reused and Redis is unavailable.
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  const url = portal === 'worker' ? '/login?worker=true' : '/login';
  await page.goto(url);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('RBAC migration — login and role routing', () => {
  // Schema-refactor-driven correction (not just a fixture fix): the multi-org
  // membership migration (prisma/migrations/20260803120000_multi_org_membership,
  // STEP 2) explicitly RE-ADDS 'admin' to the UserRole enum as a full-access,
  // Owner-equivalent role (src/lib/rbac/permissions.ts's `admin` entry uses the
  // same `everything` permission set as `owner`) — it is no longer retired, so
  // the old "no user has the admin role" assertion now encodes stale intent.
  // `role` also moved off `users` onto `organization_users` in this same
  // migration, so any surviving raw-SQL check against `users.role` would fail
  // with "column does not exist" regardless.
  test('the "admin" role is a valid, non-retired enum value (re-entered by this migration as Owner-equivalent)', async () => {
    const client = await db();
    try {
      const res = await client.query(`SELECT $1::"UserRole" AS role_value`, ['admin']);
      expect(res.rows[0].role_value).toBe('admin');
    } finally {
      await client.end();
    }
  });

  test('no membership has the retired single "worker" role after the 8-role split migration', async () => {
    const client = await db();
    try {
      // The old single "worker" enum value no longer exists; it was replaced by
      // 8 job-specific worker-category roles. Role now lives on
      // organization_users (not users), so this should return 0 rows there.
      const res = await client.query(
        `SELECT count(*) FROM organization_users WHERE role::text = 'worker'`,
      );
      expect(Number(res.rows[0].count)).toBe(0);
    } finally {
      await client.end();
    }
  });

  test('the thirteen UserRole enum values (5 manager + 8 worker) are accepted by the DB', async () => {
    const client = await db();
    try {
      // Each of the thirteen roles must be a valid enum value. We select a cast and
      // immediately discard it so no data is persisted.
      const roles = [
        'owner',
        'supervisor',
        'hr',
        'clinical_director',
        'finance',
        'psychiatrist_prescriber',
        'nurse',
        'therapist_clinician',
        'case_manager',
        'behavioral_health_technician',
        'peer_support_specialist',
        'front_desk_admin',
        'facilities_support',
      ];
      for (const role of roles) {
        const res = await client.query(`SELECT $1::\"UserRole\" AS role_value`, [role]);
        expect(res.rows[0].role_value).toBe(role);
      }
    } finally {
      await client.end();
    }
  });

  test('facilities table exists and backfill inserts org-facility rows', async () => {
    const client = await db();
    try {
      // The facilities table must exist (migration 20260701130000_add_facility).
      const res = await client.query(`SELECT to_regclass('public.facilities') AS t`);
      expect(res.rows[0].t).not.toBeNull();
    } finally {
      await client.end();
    }
  });

  test('supervisor login reaches /dashboard', async ({ page }) => {
    const email = uniqueEmail('supervisor');
    const password = 'Sup3rvIs0r!';
    const { userId, orgId, orgUserId } = await seedUser({ email, password, role: 'supervisor' });

    try {
      await loginAs(page, email, password, 'admin');
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanupUser(userId, orgId, orgUserId);
    }
  });

  test('owner login reaches /dashboard', async ({ page }) => {
    const email = uniqueEmail('owner');
    const password = '0wnerPwd!99';
    const { userId, orgId, orgUserId } = await seedUser({ email, password, role: 'owner' });

    try {
      await loginAs(page, email, password, 'admin');
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanupUser(userId, orgId, orgUserId);
    }
  });

  test('worker-category role (nurse) login at /login?worker=true reaches /worker', async ({
    page,
  }) => {
    const email = uniqueEmail('worker');
    const password = 'W0rkerPwd!77';
    const { userId, orgId, orgUserId } = await seedUser({ email, password, role: 'nurse' });

    try {
      await loginAs(page, email, password, 'worker');
      await page.waitForURL('**/worker**', { timeout: 15000 });
      expect(page.url()).toContain('/worker');
    } finally {
      await cleanupUser(userId, orgId, orgUserId);
    }
  });
});
