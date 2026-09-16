/**
 * Founder RBAC matrix — registry conformance.
 *
 * SOURCE OF TRUTH: `docs/local/RBAC-founder-answers-2026-09-15.md` (28 decisions
 * across three rounds), which resolves the matrix published in
 * `docs/local/RBAC-for-multi-tenancy.md`.
 *
 * ⛔ ANY PR THAT TOUCHES `permissions.ts` OR `role-utils.ts` MUST UPDATE THIS
 * FILE. The matrix below is the founder's directive expressed as data; the
 * assertions are exact (every verb NOT listed for a cell must be denied), so a
 * grant added or removed anywhere in the registry lands here as a red test and
 * forces a deliberate edit rather than sailing through unnoticed.
 *
 * Module → resource mapping (the matrix names product modules; the registry
 * names resources):
 *
 *   Documents        → `document`
 *   Courses          → `course`
 *   Staff Management → `user`
 *   Billing          → `billing`
 *   Audits           → `auditPack`
 *
 * Audits is `CR`, not `R`: founder answer to Q1 — "Managers with access should
 * be able to Generate reports. If that is a create action, then we should add
 * create to the rules" — so generating or exporting an auditor pack is a create.
 */
import { describe, expect, it } from 'vitest';
import { can, type Permission, type RoleKey } from './permissions';
import { ADMIN_ROLES, dbRoleToRoleKey } from './role-utils';

type Verb = 'C' | 'R' | 'U' | 'D';

const VERB_TO_ACTION = {
  C: 'create',
  R: 'read',
  U: 'edit',
  D: 'delete',
} as const satisfies Record<Verb, string>;

const ALL_VERBS = Object.keys(VERB_TO_ACTION) as Verb[];

const MODULE_RESOURCES = {
  Documents: 'document',
  Courses: 'course',
  'Staff Management': 'user',
  Billing: 'billing',
  Audits: 'auditPack',
} as const;

type MatrixModule = keyof typeof MODULE_RESOURCES;

/** The six administrative columns of the founder matrix, in matrix order. */
const MATRIX_ROLES = [
  'owner',
  'admin',
  'hr',
  'finance',
  'clinicalDirector',
  'supervisor',
] as const satisfies readonly RoleKey[];

type MatrixRole = (typeof MATRIX_ROLES)[number];

interface Cell {
  /** The letters the directive itself prints for this cell. */
  directive: string;
  /** The verbs the registry must grant. Every other verb must be denied. */
  verbs: readonly Verb[];
  /**
   * Why the registry deliberately departs from `directive`. Required exactly
   * when the two differ, and forbidden when they agree — see the last test in
   * this file, which fails both on an unexplained divergence and on a note left
   * behind after the divergence was resolved.
   */
  deviation?: string;
}

const toVerbs = (letters: string): readonly Verb[] =>
  letters === '—' ? [] : ALL_VERBS.filter((verb) => letters.includes(verb));

/** A cell where the registry matches the directive letter for letter. */
const cell = (directive: string): Cell => ({ directive, verbs: toVerbs(directive) });

/** A cell where the registry deliberately departs from the directive. */
const diverges = (directive: string, granted: string, deviation: string): Cell => ({
  directive,
  verbs: toVerbs(granted),
  deviation,
});

/**
 * The founder matrix, post-Phase-1. Rows are modules, columns are roles.
 * Legend: C create, R read, U update, D delete, `—` no access.
 */
const MATRIX: Record<MatrixModule, Record<MatrixRole, Cell>> = {
  Documents: {
    owner: cell('CRUD'),
    admin: cell('CRUD'),
    hr: cell('CRUD'),
    finance: cell('—'),
    clinicalDirector: cell('CRU'),
    supervisor: cell('R'),
  },
  Courses: {
    owner: cell('CRUD'),
    admin: cell('CRUD'),
    hr: cell('CRUD'),
    finance: cell('—'),
    // Q3 "Confirmed" — course deletion is Owner/Admin/HR only.
    clinicalDirector: cell('CRU'),
    supervisor: cell('R'),
  },
  'Staff Management': {
    owner: cell('CRUD'),
    admin: cell('CRUD'),
    hr: cell('CRUD'),
    finance: cell('—'),
    clinicalDirector: cell('—'),
    supervisor: diverges(
      'RU',
      'R',
      'Q2 narrows the "U" to assigning courses and basic profile editing, ' +
        'neither of which is `user.edit`: that same permission also gates ' +
        "changing a staff member's facility and role, which the directive's own " +
        'action rules reserve for Owner/Admin/HR. Granting it outright would ' +
        'hand supervisors powers the directive withholds, so the narrow ' +
        'capability ships as a scoped change, not as this grant. See ' +
        'docs/local/RBAC-conformance-2026-09-15.md §A.3.',
    ),
  },
  Billing: {
    owner: cell('CRUD'),
    admin: cell('CRUD'),
    hr: cell('—'),
    finance: cell('CRUD'),
    clinicalDirector: cell('—'),
    supervisor: cell('—'),
  },
  Audits: {
    owner: diverges(
      'CR',
      'CRUD',
      'Owner and Admin are defined as Owner-equivalent full CRUD on every ' +
        'resource (`everything` in permissions.ts), so the Audits letters are a ' +
        'floor for them, not a ceiling.',
    ),
    admin: diverges('CR', 'CRUD', 'See the owner cell — Owner-equivalent full CRUD.'),
    hr: cell('CR'),
    finance: cell('—'),
    clinicalDirector: cell('CR'),
    supervisor: cell('CR'),
  },
};

const MATRIX_MODULES = Object.keys(MATRIX) as MatrixModule[];

describe('founder RBAC matrix — registry conformance', () => {
  describe.each(MATRIX_MODULES)('%s', (module) => {
    const resource = MODULE_RESOURCES[module];

    describe.each(MATRIX_ROLES)('%s', (role) => {
      const { verbs } = MATRIX[module][role];

      it.each(ALL_VERBS)(`${resource}.%s matches the matrix`, (verb) => {
        const permission = `${resource}.${VERB_TO_ACTION[verb]}` as Permission;
        expect(can(role, permission), `${role} → ${permission}`).toBe(verbs.includes(verb));
      });
    });
  });

  // A seventh administrative role would silently escape the whole matrix above,
  // since the table is keyed by the six columns the directive defines.
  it('covers every administrative role in the registry — no column may be added without a matrix row', () => {
    const registryAdminRoleKeys = ADMIN_ROLES.map(dbRoleToRoleKey);
    expect([...MATRIX_ROLES].sort()).toEqual([...registryAdminRoleKeys].sort());
  });

  // Keeps the `deviation` notes honest in both directions: a cell may not depart
  // from the directive without saying why, and a note may not outlive the
  // departure it explains.
  it('records a justification for exactly the cells that depart from the directive', () => {
    const mismatched = MATRIX_MODULES.flatMap((module) =>
      MATRIX_ROLES.filter((role) => {
        const { directive, verbs, deviation } = MATRIX[module][role];
        const departs = toVerbs(directive).join('') !== verbs.join('');
        return departs !== (deviation !== undefined);
      }).map((role) => `${module}/${role}`),
    );
    expect(mismatched).toEqual([]);
  });
});
