import type { Prisma } from '@/generated/prisma/client';

/**
 * The classification vocabulary every organization starts with.
 *
 * This list is the SEED SOURCE only — the pickers and the hub filter read the
 * organization's own `DocumentCategory` rows, which members extend from the
 * upload modal. Changing this list only affects organizations created from now
 * on; existing ones were seeded by the `add_org_document_categories` migration,
 * which carries the same values (keep the two in step).
 */
export const DEFAULT_DOCUMENT_CATEGORIES = [
  'HR',
  'Compliance',
  'Clinical',
  'Operations',
  'Training',
  'Other',
] as const;

/**
 * Label of the picker entry that opens the "name a new category" step.
 *
 * It doubles as a seeded category name, so the picker renders it exactly once —
 * as the add-new affordance — rather than offering a literal "Other" bucket
 * alongside it.
 */
export const OTHER_CATEGORY_OPTION = 'Other';

/** Longest category name accepted from the custom-category input. */
export const MAX_DOCUMENT_CATEGORY_LENGTH = 60;

/**
 * Give a freshly created organization the default vocabulary.
 *
 * Runs inside the caller's transaction so a failed onboarding never leaves an
 * organization half-seeded. `skipDuplicates` makes it safe to re-run against an
 * organization that already has some of these names.
 */
export async function seedDefaultDocumentCategories(
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.documentCategory.createMany({
    data: DEFAULT_DOCUMENT_CATEGORIES.map((name) => ({ organizationId, name })),
    skipDuplicates: true,
  });
}
