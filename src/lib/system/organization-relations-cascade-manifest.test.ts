// @vitest-environment node
/**
 * The permanent organization delete (`hardDeleteOrganization`) removes everything
 * an organization owns in an explicit order, because Postgres checks a Restrict
 * edge the moment a cascade reaches it. This guard reads the Prisma schema and
 * fails CI the moment a new table joins the organization's graph, a new Restrict
 * edge appears in it, an organization-keyed table without a foreign key appears,
 * or a new storage column could leak objects — until someone classifies it here
 * and in `hard-delete-organization.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { parsePrismaSchema } from '@/test/prisma-schema';

vi.mock('@/db/index', () => ({ prisma: {}, rawPrisma: {} }));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  DELETE_BY_ORGANIZATION_ID_MODELS,
  HARD_DELETE_ORDER,
  KEPT_ORGANIZATION_ID_MODELS,
  REFERENCE_ONLY_STORAGE_COLUMNS,
  STORAGE_URI_COLUMNS,
} from './hard-delete-organization';

const schema = parsePrismaSchema();

/** Every model a row of which can hang, transitively, off an Organization. */
const EXPECTED_GRAPH = [
  'AssignmentReminderStage',
  'Certificate',
  'Course',
  'CourseArtifact',
  'CourseAssignment',
  'CourseCategory',
  'CourseModule',
  'CourseVersion',
  'Document',
  'DocumentCategory',
  'DocumentVersion',
  'Enrollment',
  'Facility',
  'FacilityDocument',
  'Invite',
  'InviteCourseAssignment',
  'Invoice',
  'Lesson',
  'ManualChunkCategory',
  'MappingEvidence',
  'Notification',
  'NotificationCategoryPreference',
  'NotificationPreference',
  'OrgCourseOffering',
  'Organization',
  'OrganizationUser',
  'OrganizationUserFacility',
  'PhiReport',
  'Question',
  'Quiz',
  'QuizAttempt',
  'ReminderLog',
  'ReminderNudge',
  'Subscription',
];

/**
 * Each Restrict edge inside the graph, with the delete step that removes the
 * referencing rows and the step that removes the referenced ones. The first
 * must come first in `HARD_DELETE_ORDER`.
 */
const RESTRICT_ALLOWLIST: Record<string, { removedBy: string; before: string }> = {
  // Courses are deleted before the memberships that authored them.
  'Course.creator': { removedBy: 'Course', before: 'OrganizationUser' },
  // Enrolments (and their certificates and attempts) go before the courses.
  'Enrollment.course': { removedBy: 'Enrollment', before: 'Course' },
  'Certificate.course': { removedBy: 'Enrollment', before: 'Course' },
  'QuizAttempt.quiz': { removedBy: 'Enrollment', before: 'Course' },
  // Course versions go with their courses, before the documents they cite.
  'CourseVersion.documentVersion': { removedBy: 'Course', before: 'Document' },
};

/** Columns named like a storage location that hold no object this delete should remove. */
const NOT_ORGANIZATION_STORAGE = [
  'Invoice.invoiceUrl',
  'Invoice.pdfUrl',
  'AuditorPack.downloadUrl',
  'Notification.linkUrl',
];

function organizationGraph(): Set<string> {
  const reached = new Set(['Organization']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const relation of schema.relations) {
      if (reached.has(relation.target) && !reached.has(relation.model)) {
        reached.add(relation.model);
        grew = true;
      }
    }
  }
  return reached;
}

describe('the organization relation graph', () => {
  const graph = organizationGraph();
  const edges = schema.relations.filter((relation) => graph.has(relation.target));

  it('finds the relations the delete is known to depend on (parser sanity)', () => {
    const found = edges.map((r) => `${r.model}.${r.field}:${r.onDelete}`);
    expect(found).toEqual(
      expect.arrayContaining([
        'OrganizationUser.organization:Cascade',
        'Course.organization:Cascade',
        'Course.creator:Restrict',
        'Enrollment.course:Restrict',
        'Enrollment.organizationUser:Cascade',
        'Course.forkedFrom:SetNull',
      ]),
    );
    expect(schema.models.length).toBeGreaterThanOrEqual(40);
  });

  it('is exactly the classified set of models', () => {
    expect([...graph].sort()).toEqual(EXPECTED_GRAPH);
  });

  it('every edge cascades, nulls, or is an allowlisted Restrict the delete order handles', () => {
    const unsafe = edges
      .filter((r) => r.onDelete !== 'Cascade' && r.onDelete !== 'SetNull')
      .map((r) => `${r.model}.${r.field}`)
      .filter((edge) => !(edge in RESTRICT_ALLOWLIST));
    expect(unsafe).toEqual([]);

    const restricting = edges
      .filter((r) => r.onDelete !== 'Cascade' && r.onDelete !== 'SetNull')
      .map((r) => `${r.model}.${r.field}`)
      .sort();
    expect(restricting).toEqual(Object.keys(RESTRICT_ALLOWLIST).sort());
  });

  it('the delete order removes each Restrict edge’s referencing rows first', () => {
    for (const [edge, { removedBy, before }] of Object.entries(RESTRICT_ALLOWLIST)) {
      const removedAt = HARD_DELETE_ORDER.indexOf(removedBy);
      const targetAt = HARD_DELETE_ORDER.indexOf(before);
      expect(removedAt, edge).toBeGreaterThanOrEqual(0);
      expect(targetAt, edge).toBeGreaterThan(removedAt);
    }
  });

  it('deletes the organization last, and never a User row', () => {
    expect(HARD_DELETE_ORDER[HARD_DELETE_ORDER.length - 1]).toBe('Organization');
    expect(HARD_DELETE_ORDER).not.toContain('User');
    for (const model of ['Course', 'Enrollment', 'Document', 'OrganizationUser', 'Facility']) {
      expect(HARD_DELETE_ORDER).toContain(model);
    }
  });
});

describe('organization-keyed tables without a foreign key', () => {
  it('each one is either deleted by id or deliberately kept', () => {
    const relatedToOrganization = new Set(
      schema.relations.filter((r) => r.target === 'Organization').map((r) => r.model),
    );
    const unconstrained = schema.fields
      .filter((f) => f.field === 'organizationId' && !relatedToOrganization.has(f.model))
      .map((f) => f.model)
      .sort();

    expect(unconstrained.length).toBeGreaterThanOrEqual(5);
    expect(unconstrained).toEqual(
      [...DELETE_BY_ORGANIZATION_ID_MODELS, ...KEPT_ORGANIZATION_ID_MODELS].sort(),
    );
  });

  it('the delete removes every by-id table before the organization row', () => {
    for (const model of DELETE_BY_ORGANIZATION_ID_MODELS) {
      expect(HARD_DELETE_ORDER.indexOf(model), model).toBeGreaterThanOrEqual(0);
    }
    for (const model of KEPT_ORGANIZATION_ID_MODELS) {
      expect(HARD_DELETE_ORDER).not.toContain(model);
    }
  });
});

describe('storage columns', () => {
  const stringFields = schema.fields.filter((f) => f.type === 'String' && !f.list);
  const referenceOnly = Object.entries(REFERENCE_ONLY_STORAGE_COLUMNS).flatMap(([model, columns]) =>
    columns.map((column) => `${model}.${column}`),
  );

  it('every storage-looking column is collected, reference-only, or not organization storage', () => {
    const unclassified = stringFields
      .map((f) => `${f.model}.${f.field}`)
      .filter((name) => /(uri|path|url)$/i.test(name))
      .filter(
        (name) =>
          !STORAGE_URI_COLUMNS.includes(name) &&
          !referenceOnly.includes(name) &&
          !NOT_ORGANIZATION_STORAGE.includes(name),
      );
    expect(unclassified).toEqual([]);
  });

  it('every listed column exists as a String field (no drift from renames)', () => {
    const known = new Set(stringFields.map((f) => `${f.model}.${f.field}`));
    for (const column of [...STORAGE_URI_COLUMNS, ...referenceOnly]) {
      expect(known.has(column), column).toBe(true);
    }
    expect(STORAGE_URI_COLUMNS.length).toBeGreaterThanOrEqual(10);
  });
});
