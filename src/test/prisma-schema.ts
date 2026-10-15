/**
 * A minimal reader of the split Prisma schema (`prisma/*.prisma`) for the
 * schema-guard manifest tests. The generated client carries no `onDelete`, so
 * these tests parse the schema source instead. Line-based on purpose: it only
 * has to understand the shapes this repo's schema files use, and each test
 * asserts known relations first so a parser that silently stops matching fails
 * loudly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PRISMA_DIR = path.resolve(__dirname, '../../prisma');

export type OnDelete = 'Cascade' | 'SetNull' | 'Restrict' | 'NoAction' | 'SetDefault';

/** The owning side of a relation: the model that holds the foreign key. */
export interface SchemaRelation {
  model: string;
  field: string;
  target: string;
  /** Explicit, or Prisma's default: SetNull for an optional relation, Restrict for a required one. */
  onDelete: OnDelete;
}

export interface SchemaField {
  model: string;
  field: string;
  type: string;
  optional: boolean;
  list: boolean;
}

export interface PrismaSchema {
  models: string[];
  relations: SchemaRelation[];
  fields: SchemaField[];
}

const MODEL_LINE = /^model\s+(\w+)\s*\{/;
const FIELD_LINE = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?(?:\s|$)/;
const RELATION_ARGS = /@relation\((.*)\)/;

export function parsePrismaSchema(): PrismaSchema {
  const models: string[] = [];
  const relations: SchemaRelation[] = [];
  const fields: SchemaField[] = [];

  for (const file of readdirSync(PRISMA_DIR).filter((name) => name.endsWith('.prisma'))) {
    let model: string | null = null;
    for (const line of readFileSync(path.join(PRISMA_DIR, file), 'utf8').split('\n')) {
      const modelMatch = MODEL_LINE.exec(line);
      if (modelMatch) {
        model = modelMatch[1];
        models.push(model);
        continue;
      }
      if (line.startsWith('}')) {
        model = null;
        continue;
      }
      const fieldMatch = model ? FIELD_LINE.exec(line) : null;
      if (!model || !fieldMatch) continue;

      const [, field, type, list, optional] = fieldMatch;
      fields.push({ model, field, type, optional: Boolean(optional), list: Boolean(list) });

      const args = RELATION_ARGS.exec(line)?.[1];
      // The owning side names its foreign key; the back-reference side does not.
      if (!args || !args.includes('fields:')) continue;
      const explicit = /onDelete:\s*(\w+)/.exec(args)?.[1];
      relations.push({
        model,
        field,
        target: type,
        onDelete: (explicit ?? (optional ? 'SetNull' : 'Restrict')) as OnDelete,
      });
    }
  }

  return { models, relations, fields };
}
