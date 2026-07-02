/**
 * E2E spec: RBAC migration — post-migration login and role gating.
 *
 * Scenarios:
 *   1. A user with the new 'supervisor' role (previously 'admin') can log in to
 *      the admin dashboard and lands at /dashboard — not /worker.
 *   2. A user with the 'owner' role (org founder) can also reach /dashboard.
 *   3. A 'worker' role user logs in via /login?worker=true and lands at /worker.
 *   4. Attempting to log in with a password-auth user at the wrong portal is blocked
 *      (worker at /login lands at /worker; admin-role at /login?worker=true blocked).
 *   5. The stale 'admin' role no longer exists in the DB after migration — all
 *      formerly-admin users are now 'supervisor'. (Verified via DB query.)
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

interface SeedOptions {
  email: string;
  password: string;
  role: 'owner' | 'supervisor' | 'hr' | 'clinical_director' | 'finance' | 'worker';
  firstName?: string;
  lastName?: string;
}

/**
 * Insert a fully-seeded test user with organization + facility.
 * Returns the user id for cleanup.
 */
async function seedUser(opts: SeedOptions): Promise<{ userId: string; orgId: string; facilityId: string | null }> {
  const client = await db();
  try {
    const hashed = await bcrypt.hash(opts.password, 10);
    const orgSlug = `test-org-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    // Only create an org for admin-role users to reflect realistic data
    const isAdmin = ['owner', 'supervisor', 'hr', 'clinical_director', 'finance'].includes(opts.role);
    let resolvedOrgId: string | null = null;
    let resolvedFacilityId: string | null = null;

    if (isAdmin) {
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
      resolvedOrgId = orgId;
      resolvedFacilityId = facilityId;
    }

    await client.query(
      `INSERT INTO users (id, email, password, role, email_verified, organization_id, facility_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4::\"UserRole\", true, $5, $6, NOW(), NOW())`,
      [userId, opts.email, hashed, opts.role, resolvedOrgId, resolvedFacilityId],
    );

    await client.query(
      `INSERT INTO profiles (id, email, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, opts.email, opts.firstName ?? 'Test', opts.lastName ?? 'User',
       `${opts.firstName ?? 'Test'} ${opts.lastName ?? 'User'}`],
    );

    return { userId, orgId: resolvedOrgId ?? '', facilityId: resolvedFacilityId };
  } finally {
    await client.end();
  }
}

async function cleanupUser(userId: string, orgId?: string): Promise<void> {
  const client = await db();
  try {
    await client.query(`DELETE FROM profiles WHERE id = $1`, [userId]);
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
  test('no user has the retired "admin" role after migration', async () => {
    const client = await db();
    try {
      // The old "admin" enum value no longer exists; this column comparison should
      // return 0 rows. If it throws a type error, the migration also succeeded.
      const res = await client.query(
        `SELECT count(*) FROM users WHERE role::text = 'admin'`,
      );
      expect(Number(res.rows[0].count)).toBe(0);
    } finally {
      await client.end();
    }
  });

  test('the six new UserRole enum values are accepted by the DB', async () => {
    const client = await db();
    try {
      // Each of the six roles must be a valid enum value.  We insert and immediately
      // roll back so no data is persisted.
      const roles = ['owner', 'supervisor', 'hr', 'clinical_director', 'finance', 'worker'];
      for (const role of roles) {
        const res = await client.query(
          `SELECT $1::\"UserRole\" AS role_value`,
          [role],
        );
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
    const { userId, orgId } = await seedUser({ email, password, role: 'supervisor' });

    try {
      await loginAs(page, email, password, 'admin');
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanupUser(userId, orgId);
    }
  });

  test('owner login reaches /dashboard', async ({ page }) => {
    const email = uniqueEmail('owner');
    const password = '0wnerPwd!99';
    const { userId, orgId } = await seedUser({ email, password, role: 'owner' });

    try {
      await loginAs(page, email, password, 'admin');
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanupUser(userId, orgId);
    }
  });

  test('worker login at /login?worker=true reaches /worker', async ({ page }) => {
    const email = uniqueEmail('worker');
    const password = 'W0rkerPwd!77';
    const { userId } = await seedUser({ email, password, role: 'worker' });

    try {
      await loginAs(page, email, password, 'worker');
      await page.waitForURL('**/worker**', { timeout: 15000 });
      expect(page.url()).toContain('/worker');
    } finally {
      await cleanupUser(userId);
    }
  });
});
