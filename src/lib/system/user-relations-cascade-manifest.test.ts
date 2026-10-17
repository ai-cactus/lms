// @vitest-environment node
/**
 * The permanent user delete (`hardDeleteUser`) deletes `OrganizationUser` and `User`
 * rows and relies on the schema to cascade or null every row pointing at them. A
 * future relation with the default (Restrict) behaviour would make that delete fail
 * at runtime with a foreign-key error, so this guard reads the Prisma schema files
 * and fails CI the moment one appears. The generated client carries no `onDelete`,
 * which is why the schema source is parsed instead.
 *
 * `hardDeleteUser` pre-checks the two allowlisted relations and refuses instead.
 */
import { describe, expect, it } from 'vitest';
import { parsePrismaSchema } from '@/test/prisma-schema';

function parseRelations() {
  return parsePrismaSchema().relations.filter(
    (relation) => relation.target === 'User' || relation.target === 'OrganizationUser',
  );
}

const ALLOWLIST = new Set(['Course.creator', 'Document.organizationUser']);

describe('relations into User and OrganizationUser', () => {
  const relations = parseRelations();

  it('finds the relations the permanent delete is known to depend on (parser sanity)', () => {
    const found = relations.map((r) => `${r.model}.${r.field}:${r.onDelete}`);
    expect(found).toEqual(
      expect.arrayContaining([
        'OrganizationUser.user:Cascade',
        'MfaFactor.user:Cascade',
        'Enrollment.organizationUser:Cascade',
        'Certificate.organizationUser:Cascade',
        'Course.creator:Restrict',
        'Course.approvedBy:SetNull',
        'OrganizationUser.manager:SetNull',
      ]),
    );
    expect(relations.length).toBeGreaterThanOrEqual(14);
  });

  it('every relation either cascades, nulls, or is an allowlisted pre-checked refusal', () => {
    const unsafe = relations
      .filter((r) => !['Cascade', 'SetNull'].includes(r.onDelete))
      .filter((r) => !ALLOWLIST.has(`${r.model}.${r.field}`))
      .map((r) => `${r.model}.${r.field} -> ${r.target} (${r.onDelete})`);

    expect(unsafe).toEqual([]);
  });

  it('the allowlist is exactly the Course.creator Restrict', () => {
    const restricting = relations
      .filter((r) => r.onDelete !== 'Cascade' && r.onDelete !== 'SetNull')
      .map((r) => `${r.model}.${r.field}`);
    expect(restricting).toEqual(['Course.creator']);
  });
});
