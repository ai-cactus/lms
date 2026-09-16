/**
 * Founder RBAC matrix — registry conformance.
 *
 * SOURCE OF TRUTH: `docs/local/RBAC_for_multi-tenancy-updated.md` — the founder's
 * latest matrix, which supersedes `RBAC_for_multi-tenancy-new.md` and, before it,
 * `RBAC-for-multi-tenancy.md` — read together with
 * `docs/local/RBAC-founder-answers-2026-09-15.md` (28 decisions across three
 * rounds), which resolves the letters the matrix leaves ambiguous.
 *
 * Against the original, the current matrix adds two rows (Quiz, Certificates)
 * and promotes Audits from `R` to `CR`; the latest revision promotes
 * Certificates from `R` to `CR` as well. Its other four rows ratify what is
 * already shipped.
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
 *   Quiz             → `assessment`
 *   Certificates     → `certificate`
 *   Staff Management → `user`
 *   Billing          → `billing`
 *   Audits           → `auditPack`
 *
 * Audits is `CR`, not `R`: founder answer to Q1 — "Managers with access should
 * be able to Generate reports. If that is a create action, then we should add
 * create to the rules" — so generating or exporting an auditor pack is a create.
 * The updated matrix now prints `CR` on that row itself, ratifying it.
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
  Quiz: 'assessment',
  Certificates: 'certificate',
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

interface AssertedCell {
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

/**
 * A cell the directive prints but that this table deliberately does not assert,
 * because the letters are ambiguous and the clarifying question is still open
 * with the founder. Asserting either reading would turn our guess into a ruling;
 * dropping the cell would leave the table silently short a column. So it is
 * carried here, unasserted, and surfaces in the run as a `todo`.
 */
interface OpenCell {
  directive: string;
  verbs: null;
  openQuestion: string;
}

type Cell = AssertedCell | OpenCell;

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

/** A cell held unasserted pending the founder's answer — see {@link OpenCell}. */
const open = (directive: string, openQuestion: string): Cell => ({
  directive,
  verbs: null,
  openQuestion,
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
  Quiz: {
    owner: cell('CRUD'),
    admin: cell('CRUD'),
    // TODO(founder, docs/local/RBAC-founder-question-quiz-row.md): the updated
    // matrix prints HR CRUD here, but `assessment` bundles two capabilities that
    // are not equivalent in privacy terms — authoring a quiz, and opening a
    // NAMED learner's question-by-question answer sheet. The question put to the
    // founder is which of the two his CRUD means; #626 narrowed
    // `getEnrollmentQuizResult` away from HR on the strength of the role's own
    // description, and only his answer settles whether that stands. Until then
    // HR holds no `assessment.*` verb and this cell asserts nothing.
    hr: open(
      'CRUD',
      'does HR Quiz CRUD mean authoring only, or a named learner’s answer sheet ' +
        'too? — docs/local/RBAC-founder-question-quiz-row.md',
    ),
    finance: cell('—'),
    clinicalDirector: cell('CRU'),
    supervisor: diverges(
      'R',
      'CR',
      'The `C` here is not the authoring verb the Quiz row means. ' +
        '`assessment.create` doubles as the self-service grant every account ' +
        'holds so it can SUBMIT ITS OWN quiz attempt (`selfServicePermissions` ' +
        'in permissions.ts — Learn Mode is unusable without it), which is why a ' +
        'read-only admin role keeps it. A supervisor authors nothing: quiz ' +
        'content is course content, gated on `course.edit` ' +
        '(assertCanEditCourseContent in actions/lesson.ts), which they do not hold.',
    ),
  },
  // `CR`, not `R`: the founder's latest revision promotes every held cell in
  // this row, on the same reading Q1 gave Audits — generating the artifact is
  // the create. The `C` has a real call site: `issueCertificate`.
  Certificates: {
    owner: diverges(
      'CR',
      'CRUD',
      'See the Audits owner cell — Owner and Admin are Owner-equivalent full ' +
        'CRUD on every resource (`everything` in permissions.ts), so the ' +
        'Certificates letters are a floor for them, not a ceiling.',
    ),
    admin: diverges('CR', 'CRUD', 'See the owner cell — Owner-equivalent full CRUD.'),
    hr: cell('CR'),
    // The matrix leaves this cell blank rather than printing `—`, but founder Q7
    // is explicit — "Finance should not be able to see certificates" — which is
    // what removed `certificate.read` from Finance in the first place. The
    // promotion to `CR` does not reach a role that holds none of the row.
    finance: cell('—'),
    clinicalDirector: cell('CR'),
    supervisor: cell('CR'),
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
      'The "U" IS delivered — it is simply not this grant. Q2 narrows it to ' +
        'assigning courses and basic profile editing (name, job title, contact, ' +
        'own facility only), while `user.edit` also gates changing a staff ' +
        "member's facility and role, which the directive's own action rules " +
        'reserve for Owner/Admin/HR. So profile editing ships as ' +
        '`STAFF_PROFILE_ACTOR_ROLES` in role-utils.ts — an actor list that ' +
        "`updateStaffDetails` checks and then narrows to the caller's own " +
        'facilities — and the facility move stays on ' +
        '`FACILITY_CHANGE_ACTOR_ROLES` (Rule A). Course assignment is already ' +
        'covered by `assignment.create`/`enrollment.create`, and withdrawal by ' +
        '`assignment.delete` (Rule C). The registry therefore grants `R` here on ' +
        'purpose. Background: docs/local/RBAC-conformance-2026-09-15.md §A.3, ' +
        'which predates this and still frames the "U" as an open question — it ' +
        'was answered and built in Phase 5.',
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

      if (verbs === null) {
        it.todo(`${resource}.* — unresolved: ${MATRIX[module][role].directive} pending an answer`);
        return;
      }

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
        const spec = MATRIX[module][role];
        // An open cell asserts nothing, so it has no divergence to justify — its
        // `openQuestion` is what keeps it honest instead.
        if (spec.verbs === null) return false;
        const departs = toVerbs(spec.directive).join('') !== spec.verbs.join('');
        return departs !== (spec.deviation !== undefined);
      }).map((role) => `${module}/${role}`),
    );
    expect(mismatched).toEqual([]);
  });
});
