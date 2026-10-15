/**
 * The word typed, alongside the organization's exact name, to confirm an
 * organization delete (soft or permanent). Kept in its own dependency-free
 * module so the client modals can import it without pulling Prisma into the
 * browser bundle.
 */
export const ORGANIZATION_DELETE_CONFIRM_WORD = 'DELETE';

export const ORGANIZATION_CONFIRMATION_MISMATCH_REFUSAL = `Type the organization name and ${ORGANIZATION_DELETE_CONFIRM_WORD} exactly to confirm.`;
