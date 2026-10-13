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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PRISMA_DIR = path.resolve(__dirname, '../../../prisma');

interface Relation {
  model: string;
  field: string;
  target: 'User' | 'OrganizationUser';
  onDelete: 'Cascade' | 'SetNull' | 'Restrict' | 'NoAction' | 'SetDefault';
}

function parseRelations(): Relation[] {
  const relations: Relation[] = [];
  for (const file of readdirSync(PRISMA_DIR).filter((name) => name.endsWith('.prisma'))) {
    let model: string | null = null;
    for (const line of readFileSync(path.join(PRISMA_DIR, file), 'utf8').split('\n')) {
      const modelMatch = /^model\s+(\w+)\s*\{/.exec(line);
      if (modelMatch) {
        model = modelMatch[1];
        continue;
      }
      if (line.startsWith('}')) {
        model = null;
        continue;
      }
      const fieldMatch = /^\s+(\w+)\s+(User|OrganizationUser)(\?)?\s+@relation\((.*)\)/.exec(line);
      // The owning side names its foreign key; the back-reference side does not.
      if (!model || !fieldMatch || !fieldMatch[4].includes('fields:')) continue;
      const [, field, target, optional, args] = fieldMatch;
      const explicit = /onDelete:\s*(\w+)/.exec(args)?.[1];
      relations.push({
        model,
        field,
        target: target as Relation['target'],
        onDelete: (explicit ?? (optional ? 'SetNull' : 'Restrict')) as Relation['onDelete'],
      });
    }
  }
  return relations;
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
