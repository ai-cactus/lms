import type { Prisma } from '@/generated/prisma/client';

export const AUDITOR_EXPORT_JOB_TYPE = 'AUDITOR_PACK_EXPORT';

/**
 * RISK-19: the organization an auditor export job was run for, stamped into its
 * payload by `/api/auditor/export/start`. `undefined` for a job created before
 * the stamp existed — those cannot be attributed after the fact, because the
 * owner of a job may belong to several organizations.
 */
export function exportJobOrganizationId(payload: Prisma.JsonValue | null): string | undefined {
  const organizationId = (payload as Record<string, unknown> | null)?.organizationId;
  return typeof organizationId === 'string' ? organizationId : undefined;
}
