/**
 * cleanup-orphaned-orgs deletes organizations that have no membership row. A
 * soft-deleted organization is restorable from /system and must never be swept
 * up by it — even though a deleted org whose members are all deactivated still
 * has membership rows, a legacy or hand-repaired org with none must not be
 * confused with one awaiting restore.
 *
 * The script runs `main()` on import, so each test mocks the db and imports it
 * fresh.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock, loggerMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: { findMany: vi.fn(), deleteMany: vi.fn() },
    $disconnect: vi.fn(),
  },
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/db/index', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));

const ORPHAN = {
  id: 'org-orphan',
  name: 'Orphan',
  createdAt: new Date('2026-01-01'),
  _count: { facilities: 0 },
};

async function runScript(argv: string[] = []) {
  const original = process.argv;
  process.argv = ['node', 'cleanup-orphaned-orgs.ts', ...argv];
  vi.resetModules();
  await import('./cleanup-orphaned-orgs');
  await vi.waitFor(() => expect(prismaMock.$disconnect).toHaveBeenCalled());
  process.argv = original;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organization.findMany.mockResolvedValue([]);
  prismaMock.organization.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('cleanup-orphaned-orgs', () => {
  it('scans only live organizations that have no membership row at all', async () => {
    await runScript();

    expect(prismaMock.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationUsers: { none: {} }, deletedAt: null } }),
    );
  });

  it('deletes exactly the orphans the live-only scan returned', async () => {
    prismaMock.organization.findMany.mockResolvedValue([ORPHAN]);
    prismaMock.organization.deleteMany.mockResolvedValue({ count: 1 });

    await runScript();

    expect(prismaMock.organization.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['org-orphan'] } },
    });
  });

  it('writes nothing on --dry-run', async () => {
    prismaMock.organization.findMany.mockResolvedValue([ORPHAN]);

    await runScript(['--dry-run']);

    expect(prismaMock.organization.deleteMany).not.toHaveBeenCalled();
  });
});
