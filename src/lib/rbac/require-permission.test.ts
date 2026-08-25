/**
 * The `dataFacilityIds` invariant.
 *
 * D-01's scope half was not a missing concept — `isOrgWideFacilityRole` already
 * existed and already excluded supervisor. The bug was that a page derived its
 * facility ids from the `?facility=` URL parameter, got `[]` for a supervisor
 * who had not chosen one, and passed that on as "no filter" — widening a
 * facility-bound role to the whole organisation.
 *
 * These tests pin the rule that prevents a repeat: an empty selection NEVER
 * means "everything". `null` is reserved for org-wide roles viewing "all".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const evaluatePermission = vi.fn();
const listAccessibleFacilities = vi.fn();
const resolveFacilityScopeSelection = vi.fn();
const isOrgWideFacilityRole = vi.fn();

vi.mock('./authorize', () => ({
  evaluatePermission: (...a: unknown[]) => evaluatePermission(...a),
}));
vi.mock('@/lib/facility/scope', () => ({
  listAccessibleFacilities: (...a: unknown[]) => listAccessibleFacilities(...a),
  resolveFacilityScopeSelection: (...a: unknown[]) => resolveFacilityScopeSelection(...a),
  isOrgWideFacilityRole: (...a: unknown[]) => isOrgWideFacilityRole(...a),
}));
const redirect = vi.fn(() => {
  throw new Error('NEXT_REDIRECT');
});
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({
  redirect: (...a: unknown[]) => redirect(...(a as [])),
  notFound: () => notFound(),
}));

const { requirePermission, requirePermissionWithFacilityScope } =
  await import('./require-permission');

const ctxFor = (role: string) => ({
  ok: true as const,
  ctx: {
    userId: 'u1',
    email: 'a@b.c',
    role,
    roleKey: role,
    organizationId: 'org1',
    organizationUserId: 'ou1',
  },
});

const facility = (id: string) => ({ id, name: id, type: null, city: null });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requirePermission', () => {
  it('returns the context when the permission is held', async () => {
    evaluatePermission.mockResolvedValue(ctxFor('hr'));
    await expect(requirePermission('user.read')).resolves.toMatchObject({ role: 'hr' });
  });

  it('redirects on denial rather than returning an unauthorized context', async () => {
    evaluatePermission.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await expect(requirePermission('user.read')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  // Denial is not one case. Collapsing these sends a logged-out visitor to
  // /dashboard, which bounces them again; and an authenticated-but-forbidden
  // caller to /login, which is a dead end.
  it('sends an UNAUTHENTICATED caller to /login, not the forbidden destination', async () => {
    evaluatePermission.mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    await expect(requirePermission('user.read')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('an unauthenticated caller goes to /login even when onDeny is notFound', async () => {
    evaluatePermission.mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    await expect(requirePermission('user.read', { onDeny: 'notFound' })).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('404s instead of 403ing when onDeny is notFound — an id-addressed page must not confirm existence', async () => {
    evaluatePermission.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await expect(requirePermission('user.read', { onDeny: 'notFound' })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

describe('dataFacilityIds invariant', () => {
  it('org-wide role viewing "all" → null (the ONLY case that yields null)', async () => {
    evaluatePermission.mockResolvedValue(ctxFor('hr'));
    isOrgWideFacilityRole.mockReturnValue(true);
    resolveFacilityScopeSelection.mockResolvedValue({ mode: 'all' });
    listAccessibleFacilities.mockResolvedValue([facility('f1'), facility('f2')]);

    const ctx = await requirePermissionWithFacilityScope('user.read');
    expect(ctx.dataFacilityIds).toBeNull();
    expect(ctx.orgWide).toBe(true);
  });

  it('facility-bound role with NO selection → its accessible ids, NOT null (the status-tracker bug)', async () => {
    evaluatePermission.mockResolvedValue(ctxFor('supervisor'));
    isOrgWideFacilityRole.mockReturnValue(false);
    resolveFacilityScopeSelection.mockResolvedValue({ mode: 'all' });
    listAccessibleFacilities.mockResolvedValue([facility('annex')]);

    const ctx = await requirePermissionWithFacilityScope('user.read');
    expect(ctx.dataFacilityIds).toEqual(['annex']);
    expect(ctx.dataFacilityIds).not.toBeNull();
    // view state stays empty — it is the URL selection, not the boundary
    expect(ctx.selectedFacilityIds).toEqual([]);
  });

  it('facility-bound role with NO facility assignments → [] (see nothing), never null', async () => {
    evaluatePermission.mockResolvedValue(ctxFor('supervisor'));
    isOrgWideFacilityRole.mockReturnValue(false);
    resolveFacilityScopeSelection.mockResolvedValue({ mode: 'all' });
    listAccessibleFacilities.mockResolvedValue([]);

    const ctx = await requirePermissionWithFacilityScope('user.read');
    expect(ctx.dataFacilityIds).toEqual([]);
    expect(ctx.dataFacilityIds).not.toBeNull();
  });

  it('an explicit single selection narrows an org-wide role', async () => {
    evaluatePermission.mockResolvedValue(ctxFor('hr'));
    isOrgWideFacilityRole.mockReturnValue(true);
    resolveFacilityScopeSelection.mockResolvedValue({ mode: 'single', facility: facility('f2') });
    listAccessibleFacilities.mockResolvedValue([facility('f1'), facility('f2')]);

    const ctx = await requirePermissionWithFacilityScope('user.read', 'f2');
    expect(ctx.dataFacilityIds).toEqual(['f2']);
  });

  it('a compare selection carries every chosen id', async () => {
    evaluatePermission.mockResolvedValue(ctxFor('owner'));
    isOrgWideFacilityRole.mockReturnValue(true);
    resolveFacilityScopeSelection.mockResolvedValue({
      mode: 'compare',
      facilities: [facility('f1'), facility('f2')],
    });
    listAccessibleFacilities.mockResolvedValue([facility('f1'), facility('f2')]);

    const ctx = await requirePermissionWithFacilityScope('user.read', ['f1', 'f2']);
    expect(ctx.dataFacilityIds).toEqual(['f1', 'f2']);
  });

  it('never resolves scope for a caller who failed the permission check', async () => {
    evaluatePermission.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await expect(requirePermissionWithFacilityScope('user.read')).rejects.toThrow('NEXT_REDIRECT');
    expect(listAccessibleFacilities).not.toHaveBeenCalled();
  });
});
