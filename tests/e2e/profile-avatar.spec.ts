/**
 * E2E spec: own-profile avatar (BUG-65).
 *
 * The profile pages used to ship the stored avatar's storage URI (bucket and
 * object key) to the browser next to the signed display URL, only so the form
 * could echo it back on save. They now send only the signed URL.
 *
 * Acceptance criteria (worker /worker/profile and admin /dashboard/profile):
 *   - The rendered page (HTML and RSC payload) contains no gcs:// or minio://
 *     URI, including when an avatar is stored.
 *   - Uploading a photo and saving persists an object under the caller's own
 *     avatars/<userId>/ prefix, and the reloaded page shows it via a signed URL.
 *   - Saving with no new upload leaves the stored avatar untouched.
 *
 * Pre-conditions: app on :3005 and DATABASE_URL reachable (prisma/seed.ts
 * fixtures). The seeded users' avatar_url is reset before and after.
 */

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:0951@localhost:5433/lms?schema=public';

const STORAGE_URI = /(?:gcs|minio):\/\//;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const resetAvatar = (email: string) =>
  withDb((c) => c.query(`UPDATE users SET avatar_url = NULL WHERE email = $1`, [email]));

const storedAvatar = (email: string) =>
  withDb(async (c) => {
    const r = await c.query(`SELECT id, avatar_url FROM users WHERE email = $1`, [email]);
    return r.rows[0] as { id: string; avatar_url: string | null };
  });

async function login(page: Page, email: string, password: string, landing: string) {
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('modal_dismissed_dashboardEmptyState', 'forever');
  });
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(landing, { timeout: 20000 });
}

async function documentBodies(page: Page, path: string): Promise<string> {
  const response = await page.goto(path);
  const html = (await response?.text()) ?? '';
  const rendered = await page.content();
  return `${html}\n${rendered}`;
}

test.describe.configure({ mode: 'serial' });

test.describe('Worker profile avatar', () => {
  const EMAIL = 'nina.nurse@test.com';
  test.beforeEach(() => resetAvatar(EMAIL));
  test.afterEach(() => resetAvatar(EMAIL));

  test('uploading and saving persists an own-prefix avatar and no page ever carries a storage URI', async ({
    page,
  }) => {
    await login(page, EMAIL, 'TestPassword123!', '**/worker**');

    expect(await documentBodies(page, '/worker/profile')).not.toMatch(STORAGE_URI);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    const save = page.getByRole('button', { name: 'Save Changes' });
    await expect(save).toBeEnabled({ timeout: 15000 });
    await save.click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Profile updated successfully')).toBeVisible();

    const row = await storedAvatar(EMAIL);
    expect(row.avatar_url).toMatch(STORAGE_URI);
    expect(row.avatar_url).toContain(`/avatars/${row.id}/`);

    const after = await documentBodies(page, '/worker/profile');
    expect(after).not.toMatch(STORAGE_URI);
    await expect(page.getByRole('img', { name: 'Profile' })).toHaveAttribute('src', /^https?:/);
  });

  test('saving a name change without a new upload leaves the stored avatar untouched', async ({
    page,
  }) => {
    const seeded = `minio://lms-documents/avatars/${(await storedAvatar(EMAIL)).id}/1700000000000-keep.png`;
    await withDb((c) =>
      c.query(`UPDATE users SET avatar_url = $2 WHERE email = $1`, [EMAIL, seeded]),
    );
    await login(page, EMAIL, 'TestPassword123!', '**/worker**');
    expect(await documentBodies(page, '/worker/profile')).not.toMatch(STORAGE_URI);

    const first = page.locator('input[name="first_name"]');
    const original = await first.inputValue();
    await first.fill(`${original}x`);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Profile updated successfully')).toBeVisible();

    expect((await storedAvatar(EMAIL)).avatar_url).toBe(seeded);
    await withDb((c) =>
      c.query(
        `UPDATE users SET first_name = $2, full_name = $2 || ' ' || last_name WHERE email = $1`,
        [EMAIL, original],
      ),
    );
  });
});

test.describe('Admin profile avatar', () => {
  const EMAIL = 'admin@test.com';
  test.beforeEach(() => resetAvatar(EMAIL));
  test.afterEach(() => resetAvatar(EMAIL));

  test('uploading and saving persists an own-prefix avatar and the page never carries a storage URI', async ({
    page,
  }) => {
    await login(page, EMAIL, 'Admin123!', '**/dashboard**');
    expect(await documentBodies(page, '/dashboard/profile')).not.toMatch(STORAGE_URI);

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled({ timeout: 15000 });
    await save.click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Profile updated successfully')).toBeVisible();

    const row = await storedAvatar(EMAIL);
    expect(row.avatar_url).toMatch(STORAGE_URI);
    expect(row.avatar_url).toContain(`/avatars/${row.id}/`);
    expect(await documentBodies(page, '/dashboard/profile')).not.toMatch(STORAGE_URI);
  });
});
