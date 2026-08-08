/**
 * E2E spec: /dashboard/settings (Phase C — new owner-only Settings page).
 *
 * Acceptance criteria:
 *   - Owner sees all three tabs (Users & Permissions, Roles, Facility) and the
 *     "Settings" nav entry in the sidebar.
 *   - A non-owner admin (hr) gets the styled access-denied card at
 *     /dashboard/settings AND does not see the "Settings" nav item at all.
 *   - Saving the Facility tab's name/type persists via `updateFacility` (DB
 *     row updated), matching the "Your Facility" persistence pattern already
 *     covered for /dashboard/profile in rbac-facility-tab.spec.ts.
 *
 * Pre-conditions:
 *   - App running on http://localhost:3005.
 *   - DATABASE_URL reachable for seeding + DB assertions.
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

type Role = 'owner' | 'hr';

interface Seeded {
  userId: string;
  orgId: string;
  facilityId: string;
  orgUserId: string;
}

async function seedWithRole(role: Role, email: string, password: string): Promise<Seeded> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const hashed = await bcrypt.hash(password, 10);
    const slug = `settings-test-${crypto.randomBytes(4).toString('hex')}`;
    const orgId = crypto.randomUUID();
    const facilityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const orgUserId = crypto.randomUUID();

    await client.query(
      `INSERT INTO organizations (id, name, slug, primary_email, is_hipaa_compliant, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
      [orgId, `Settings Test ${slug}`, slug, email],
    );
    await client.query(
      `INSERT INTO facilities (id, organization_id, name, program_services, created_at, updated_at)
       VALUES ($1, $2, $3, '{}', NOW(), NOW())`,
      [facilityId, orgId, `Settings Test Facility ${slug}`],
    );
    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [userId, email, hashed, 'Settings', 'Test', 'Settings Test'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [orgUserId, userId, orgId, role],
    );
    await client.query(
      `INSERT INTO organization_user_facilities (id, organization_user_id, facility_id, active, joined_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [crypto.randomUUID(), orgUserId, facilityId],
    );
    return { userId, orgId, facilityId, orgUserId };
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
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@settings-e2e.invalid`;
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  const ip = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  // Pre-dismiss the "create your first course" empty-state modal — its overlay
  // sits above the sidebar and would intercept clicks on the Settings nav link.
  await page.addInitScript(() => {
    window.localStorage.setItem('modal_dismissed_dashboardEmptyState', 'forever');
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
}

test.describe('Settings page — owner-only access', () => {
  test('owner sees the Settings nav entry and all three tabs at /dashboard/settings', async ({
    page,
  }) => {
    const email = uid('owner');
    const seeded = await seedWithRole('owner', email, 'Owne!rSet99x');
    try {
      await login(page, email, 'Owne!rSet99x');

      await expect(page.getByRole('link', { name: /^settings$/i })).toBeVisible();
      await page.getByRole('link', { name: /^settings$/i }).click();
      await page.waitForURL('**/dashboard/settings**');

      await expect(page.getByRole('tab', { name: /users.*permissions/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /^roles$/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /^facility$/i })).toBeVisible();
      await expect(page.getByText(/don.t have access to settings/i)).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('hr gets access-denied at /dashboard/settings and has no Settings nav entry', async ({
    page,
  }) => {
    const email = uid('hr');
    const seeded = await seedWithRole('hr', email, 'HrSet!99xPP');
    try {
      await login(page, email, 'HrSet!99xPP');

      // No Settings nav entry at all for a non-owner admin.
      await expect(page.getByRole('link', { name: /^settings$/i })).not.toBeVisible();

      // Direct navigation is still gated server-side.
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(/don.t have access to settings/i)).toBeVisible();
      await expect(page.getByRole('tab', { name: /^facility$/i })).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Settings page — Facility tab persistence', () => {
  test('owner can update facility name/type and the change persists via updateFacility', async ({
    page,
  }) => {
    const email = uid('owner-facility');
    const seeded = await seedWithRole('owner', email, 'Own3rFacil!ty9');
    const newName = `Renamed Facility ${crypto.randomBytes(3).toString('hex')}`;
    try {
      await login(page, email, 'Own3rFacil!ty9');
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');

      await page.getByRole('tab', { name: /^facility$/i }).click();

      // "Facility name" is a real <Input> — Field's id-clone reaches its DOM
      // node correctly here (unlike the Select-based "Facility type" field).
      const nameInput = page.getByLabel('Facility name');
      await nameInput.fill(newName);

      // The type field is a FacilityTypeMultiSelect: a popover trigger
      // (aria-haspopup="listbox") over checkboxes, not a Radix Select. The
      // popover portals to <body>, so the checkbox is located page-wide, and
      // Escape closes only the popover before saving.
      await page.locator('button[aria-haspopup="listbox"]').click();
      await page.getByRole('checkbox', { name: 'Private Practice / Group Practice' }).click();
      await page.keyboard.press('Escape');

      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/dashboard/settings') && resp.status() === 200,
        { timeout: 10000 },
      );
      await page.getByRole('button', { name: /save changes/i }).click();
      await responsePromise;

      await expect(page.getByText(/facility updated/i)).toBeVisible({ timeout: 10000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(`SELECT name, type FROM facilities WHERE id = $1`, [
          seeded.facilityId,
        ]);
        expect(res.rows[0]).toMatchObject({
          name: newName,
          type: 'Private Practice / Group Practice',
        });
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});

interface SeededWithSupervisor extends Seeded {
  supervisorUserId: string;
  supervisorOrgUserId: string;
  supervisorEmail: string;
}

/**
 * Owner + an already-active org supervisor with no facility assignment yet —
 * the roster shape `getSupervisorOptions()` reads from and the exact case
 * `createFacility` resolves via `organizationUserFacility.upsert` when the
 * admin picks them from the modal's combobox.
 */
async function seedOwnerWithSupervisor(
  ownerEmail: string,
  ownerPassword: string,
): Promise<SeededWithSupervisor> {
  const seeded = await seedWithRole('owner', ownerEmail, ownerPassword);
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const supervisorUserId = crypto.randomUUID();
    const supervisorOrgUserId = crypto.randomUUID();
    const supervisorEmail = uid('supervisor-addfac');
    const hashed = await bcrypt.hash('SupervisorSeed!9x', 10);

    await client.query(
      `INSERT INTO users (id, email, password, email_verified, auth_provider, first_name, last_name, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, true, 'credentials', $4, $5, $6, NOW(), NOW())`,
      [supervisorUserId, supervisorEmail, hashed, 'Sasha', 'Supervisor', 'Sasha Supervisor'],
    );
    await client.query(
      `INSERT INTO organization_users (id, user_id, organization_id, role, active, joined_at, role_assigned_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'supervisor'::"UserRole", true, NOW(), NOW(), NOW(), NOW())`,
      [supervisorOrgUserId, supervisorUserId, seeded.orgId],
    );

    return { ...seeded, supervisorUserId, supervisorOrgUserId, supervisorEmail };
  } finally {
    await client.end();
  }
}

async function cleanupSupervisor(seeded: SeededWithSupervisor): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM organization_user_facilities WHERE organization_user_id = $1`, [
      seeded.supervisorOrgUserId,
    ]);
    await client.query(`DELETE FROM organization_users WHERE id = $1`, [
      seeded.supervisorOrgUserId,
    ]);
    await client.query(`DELETE FROM users WHERE id = $1`, [seeded.supervisorUserId]);
  } finally {
    await client.end();
  }
  await cleanup(seeded);
}

test.describe('Settings page — Add Facility (multi-facility v3)', () => {
  test('owner adds a facility with no supervisor email; it is created and persisted', async ({
    page,
  }) => {
    const email = uid('owner-addfac');
    const seeded = await seedWithRole('owner', email, 'AddFacOwn3r!9');
    const newFacilityName = `New Site ${crypto.randomBytes(3).toString('hex')}`;
    try {
      await login(page, email, 'AddFacOwn3r!9');
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^facility$/i }).click();

      await page.getByRole('button', { name: 'Add Facility' }).click();
      // Scope to the dialog: the underlying Facility tab's own "Facility name"
      // input shares the same placeholder text as the modal's.
      const addFacilityDialog = page.getByRole('dialog', { name: /add a new facility/i });
      await expect(addFacilityDialog).toBeVisible();

      await addFacilityDialog
        .getByPlaceholder('e.g. Sunrise Behavioral Health')
        .fill(newFacilityName);
      await addFacilityDialog
        .getByRole('checkbox', { name: 'Private Practice / Group Practice' })
        .click();

      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/dashboard/settings') && resp.status() === 200,
      );
      await addFacilityDialog.getByRole('button', { name: 'Create facility' }).click();
      await responsePromise;

      await expect(page.getByText('Facility created.')).toBeVisible({ timeout: 10000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(
          `SELECT id, type FROM facilities WHERE organization_id = $1 AND name = $2`,
          [seeded.orgId, newFacilityName],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].type).toBe('Private Practice / Group Practice');
        await client.query(`DELETE FROM facilities WHERE id = $1`, [res.rows[0].id]);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });

  test('a non-owner admin (hr) has no Add Facility button — lacks facility.create', async ({
    page,
  }) => {
    const email = uid('hr-addfac');
    const seeded = await seedWithRole('hr', email, 'AddFacHr!99x');
    try {
      await login(page, email, 'AddFacHr!99x');

      // hr is denied the whole settings page (owner-only per the earlier
      // access-control suite), so the Add Facility button is unreachable —
      // confirms the deeper gate rather than merely the button's own check.
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('button', { name: 'Add Facility' })).not.toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });

  test('owner picks two types plus an "Other" description; the DB row holds the joined string', async ({
    page,
  }) => {
    const email = uid('owner-addfac-types');
    const seeded = await seedWithRole('owner', email, 'AddFacTypes!9x');
    const newFacilityName = `Multi-Type Site ${crypto.randomBytes(3).toString('hex')}`;
    const otherType = 'Mobile crisis unit';
    try {
      await login(page, email, 'AddFacTypes!9x');
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^facility$/i }).click();
      await page.getByRole('button', { name: 'Add Facility' }).click();

      const addFacilityDialog = page.getByRole('dialog', { name: /add a new facility/i });
      await expect(addFacilityDialog).toBeVisible();

      await addFacilityDialog
        .getByPlaceholder('e.g. Sunrise Behavioral Health')
        .fill(newFacilityName);
      await addFacilityDialog
        .getByRole('checkbox', { name: 'Community Mental Health Center' })
        .click();
      await addFacilityDialog
        .getByRole('checkbox', { name: 'Behavioral Health Hospital / Psychiatric Hospital' })
        .click();
      await addFacilityDialog.getByRole('button', { name: 'Other (specify)' }).click();
      await addFacilityDialog.getByPlaceholder('Describe the facility type').fill(otherType);

      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/dashboard/settings') && resp.status() === 200,
      );
      await addFacilityDialog.getByRole('button', { name: 'Create facility' }).click();
      await responsePromise;

      await expect(page.getByText('Facility created.')).toBeVisible({ timeout: 10000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(
          `SELECT id, type FROM facilities WHERE organization_id = $1 AND name = $2`,
          [seeded.orgId, newFacilityName],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].type).toBe(
          `Community Mental Health Center, Behavioral Health Hospital / Psychiatric Hospital, ${otherType}`,
        );
        await client.query(`DELETE FROM facilities WHERE id = $1`, [res.rows[0].id]);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });

  test('owner picks an existing supervisor from the combobox; they are assigned to the new facility', async ({
    page,
  }) => {
    const email = uid('owner-addfac-sup');
    const seeded = await seedOwnerWithSupervisor(email, 'AddFacSup!99x');
    const newFacilityName = `Supervised Site ${crypto.randomBytes(3).toString('hex')}`;
    try {
      await login(page, email, 'AddFacSup!99x');
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^facility$/i }).click();
      await page.getByRole('button', { name: 'Add Facility' }).click();

      const addFacilityDialog = page.getByRole('dialog', { name: /add a new facility/i });
      await expect(addFacilityDialog).toBeVisible();

      await addFacilityDialog
        .getByPlaceholder('e.g. Sunrise Behavioral Health')
        .fill(newFacilityName);
      await addFacilityDialog
        .getByRole('checkbox', { name: 'Private Practice / Group Practice' })
        .click();

      await addFacilityDialog.getByRole('button', { name: 'Show supervisors' }).click();
      // The Popover's content is rendered in a Radix portal appended to
      // <body>, outside the dialog's own DOM subtree — must query from `page`,
      // not scoped to `addFacilityDialog`.
      const listbox = page.getByRole('listbox', { name: 'Existing supervisors' });
      await expect(listbox).toBeVisible({ timeout: 10000 });
      await listbox.getByRole('option', { name: new RegExp(seeded.supervisorEmail) }).click();

      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/dashboard/settings') && resp.status() === 200,
      );
      await addFacilityDialog.getByRole('button', { name: 'Create facility' }).click();
      await responsePromise;

      await expect(
        page.getByText(`Facility created. We assigned ${seeded.supervisorEmail} to manage it.`),
      ).toBeVisible({ timeout: 10000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const facilityRes = await client.query(
          `SELECT id FROM facilities WHERE organization_id = $1 AND name = $2`,
          [seeded.orgId, newFacilityName],
        );
        expect(facilityRes.rows).toHaveLength(1);
        const newFacilityId = facilityRes.rows[0].id;

        const assignmentRes = await client.query(
          `SELECT active FROM organization_user_facilities
           WHERE organization_user_id = $1 AND facility_id = $2`,
          [seeded.supervisorOrgUserId, newFacilityId],
        );
        expect(assignmentRes.rows).toHaveLength(1);
        expect(assignmentRes.rows[0].active).toBe(true);

        await client.query(`DELETE FROM facilities WHERE id = $1`, [newFacilityId]);
      } finally {
        await client.end();
      }
    } finally {
      await cleanupSupervisor(seeded);
    }
  });

  test('owner types an unseeded email; a facility-scoped supervisor invite is created', async ({
    page,
  }) => {
    const email = uid('owner-addfac-invite');
    const seeded = await seedWithRole('owner', email, 'AddFacInv!99x');
    const newFacilityName = `Invite Site ${crypto.randomBytes(3).toString('hex')}`;
    const unknownEmail = uid('unknown-supervisor');
    try {
      await login(page, email, 'AddFacInv!99x');
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^facility$/i }).click();
      await page.getByRole('button', { name: 'Add Facility' }).click();

      const addFacilityDialog = page.getByRole('dialog', { name: /add a new facility/i });
      await expect(addFacilityDialog).toBeVisible();

      await addFacilityDialog
        .getByPlaceholder('e.g. Sunrise Behavioral Health')
        .fill(newFacilityName);
      await addFacilityDialog
        .getByRole('checkbox', { name: 'Private Practice / Group Practice' })
        .click();
      await addFacilityDialog
        .getByPlaceholder('e.g. supervisor@yourfacility.com')
        .fill(unknownEmail);

      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/dashboard/settings') && resp.status() === 200,
      );
      await addFacilityDialog.getByRole('button', { name: 'Create facility' }).click();
      await responsePromise;

      // The invite email's delivery outcome depends on the local SMTP sink, but
      // the invite row itself is written before the send attempt — assert
      // loosely on the shared "Facility created" prefix and precisely on the DB.
      await expect(page.getByText(/Facility created/)).toBeVisible({ timeout: 10000 });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const facilityRes = await client.query(
          `SELECT id FROM facilities WHERE organization_id = $1 AND name = $2`,
          [seeded.orgId, newFacilityName],
        );
        expect(facilityRes.rows).toHaveLength(1);
        const newFacilityId = facilityRes.rows[0].id;

        const inviteRes = await client.query(
          `SELECT role, facility_id FROM invites WHERE email = $1 AND organization_id = $2`,
          [unknownEmail, seeded.orgId],
        );
        expect(inviteRes.rows).toHaveLength(1);
        expect(inviteRes.rows[0].role).toBe('supervisor');
        expect(inviteRes.rows[0].facility_id).toBe(newFacilityId);

        await client.query(`DELETE FROM invites WHERE email = $1 AND organization_id = $2`, [
          unknownEmail,
          seeded.orgId,
        ]);
        await client.query(`DELETE FROM facilities WHERE id = $1`, [newFacilityId]);
      } finally {
        await client.end();
      }
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Settings page — Notifications tab persistence', () => {
  test('owner can switch the digest frequency to weekly and it persists after reload', async ({
    page,
  }) => {
    const email = uid('owner-notif');
    const seeded = await seedWithRole('owner', email, 'Own3rNotif!y9');
    try {
      await login(page, email, 'Own3rNotif!y9');
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');

      await page.getByRole('tab', { name: /^notifications$/i }).click();

      // A freshly-seeded organization defaults to daily; assert the starting
      // state before changing it, so the persistence check below is meaningful.
      await expect(page.getByRole('radio', { name: /^daily/i })).toBeChecked();

      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/dashboard/settings') && resp.status() === 200,
        { timeout: 10000 },
      );
      await page.getByRole('radio', { name: /^weekly/i }).click();
      await page.getByRole('button', { name: /save changes/i }).click();
      await responsePromise;

      await expect(page.getByText(/notification settings updated/i)).toBeVisible({
        timeout: 10000,
      });

      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        const res = await client.query(
          `SELECT notification_digest_frequency FROM organizations WHERE id = $1`,
          [seeded.orgId],
        );
        expect(res.rows[0].notification_digest_frequency).toBe('weekly');
      } finally {
        await client.end();
      }

      // Persistence check: a hard reload must re-fetch the server-rendered
      // value rather than relying on client-side form state.
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^notifications$/i }).click();
      await expect(page.getByRole('radio', { name: /^weekly/i })).toBeChecked();
    } finally {
      await cleanup(seeded);
    }
  });

  test('a non-owner admin (hr) cannot reach the Notifications tab at all', async ({ page }) => {
    const email = uid('hr-notif');
    const seeded = await seedWithRole('hr', email, 'HrNotif!y99x');
    try {
      await login(page, email, 'HrNotif!y99x');
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('tab', { name: /^notifications$/i })).not.toBeVisible();
      await expect(page.getByText(/don.t have access to settings/i)).toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});
