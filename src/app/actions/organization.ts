'use server';

import crypto from 'crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { dbRoleToRoleKey, getRoleDisplayName } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { logger, maskEmail } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';
import { deriveTimezoneFromState } from '@/lib/reminders/us-state-timezone';
import { createMembership } from '@/lib/auth/membership';
import { createInvites } from '@/app/actions/invite';

interface OrganizationUpdateData {
  name?: string;
  dba?: string;
  ein?: string;
  staffCount?: string;
  primaryContact?: string;
  primaryEmail?: string;
  phone?: string;
  address?: string;
  country?: string;
  state?: string;
  zipCode?: string;
  city?: string;
  timezone?: string;
  licenseNumber?: string;
  isHipaaCompliant?: boolean;
  // Services fields (Step 3 data)
  primaryBusinessType?: string;
  additionalBusinessTypes?: string[];
  programServices?: string[];
  complianceDocumentUrl?: string;
  complianceDocumentName?: string;
}

export async function updateOrganization(data: OrganizationUpdateData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      logger.error({ msg: '[org] updateOrganization: no org for user', userId: session.user.id });
      return { success: false, error: 'No organization found' };
    }

    // Granular gate, mirroring updateFacility: the coarse admin-tier check let
    // every admin-tier role through, which since the RBAC ruling demoted
    // Supervisor (and excluded HR/Clinical/Finance from org settings) would be a
    // privilege escalation. `organization.edit` resolves to Owner/Admin only.
    if (!can(dbRoleToRoleKey(session.user.role), 'organization.edit')) {
      logger.warn({
        msg: '[org] updateOrganization: insufficient permission',
        userId: session.user.id,
        role: session.user.role,
      });
      return { success: false, error: 'You do not have permission to update this organization' };
    }

    // Org-only fields live on Organization; location/compliance fields now live
    // on the Facility. `?? undefined` avoids clobbering array columns when a
    // caller omits them (moved fields are usually saved via updateFacility).
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: data.name,
        dba: data.dba,
        ein: data.ein,
        primaryContact: data.primaryContact,
        primaryEmail: data.primaryEmail,
        isHipaaCompliant: data.isHipaaCompliant,
        primaryBusinessType: data.primaryBusinessType,
        additionalBusinessTypes: data.additionalBusinessTypes ?? undefined,
      },
    });

    // Moved fields → the caller's facility (if their membership has one attached).
    const membershipFacility = session.user.organizationUserId
      ? await prisma.organizationUserFacility.findFirst({
          where: { organizationUserId: session.user.organizationUserId, active: true },
          select: { facilityId: true },
        })
      : null;

    if (membershipFacility) {
      await prisma.facility.update({
        where: { id: membershipFacility.facilityId },
        data: {
          staffCount: data.staffCount,
          phone: data.phone,
          address: data.address,
          city: data.city,
          country: data.country,
          state: data.state,
          zipCode: data.zipCode,
          timezone: data.timezone,
          licenseNumber: data.licenseNumber,
          programServices: data.programServices ?? undefined,
          complianceDocumentUrl: data.complianceDocumentUrl,
          complianceDocumentName: data.complianceDocumentName,
        },
      });
    }

    logger.info({
      msg: '[org] Organization updated',
      orgId: organizationId,
      userId: session.user.id,
    });

    // F-001: record the sensitive settings mutation on the authorized path.
    // Metadata is intentionally PII-free (no names/emails/addresses/EIN values).
    await audit({
      action: 'org.settings.update',
      actorId: session.user.id,
      actorRole: session.user.role,
      organizationId,
      targetType: 'organization',
      targetId: organizationId,
      ...getClientContext(await headers()),
    });

    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error updating organization:', err: error });
    return { success: false, error: 'Failed to update organization' };
  }
}

export async function getOrganization() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated', data: null };
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return { success: false, error: 'No organization found', data: null };
    }

    const [organization, membershipFacility] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId } }),
      session.user.organizationUserId
        ? prisma.organizationUserFacility.findFirst({
            where: { organizationUserId: session.user.organizationUserId, active: true },
            select: { facility: true },
          })
        : Promise.resolve(null),
    ]);

    if (!organization) {
      return { success: false, error: 'No organization found', data: null };
    }

    // Nested shape: facility may be null for users not yet attached to one.
    return {
      success: true,
      data: { organization, facility: membershipFacility?.facility ?? null },
    };
  } catch (error) {
    logger.error({ msg: 'Error fetching organization:', err: error });
    return { success: false, error: 'Failed to fetch organization', data: null };
  }
}

interface FacilityUpdateData {
  name?: string;
  type?: string;
  staffCount?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  state?: string;
  zipCode?: string;
  licenseNumber?: string;
  programServices?: string[];
  complianceDocumentUrl?: string;
  complianceDocumentName?: string;
}

// Update the current user's facility. Permission-gated on `facility.edit`, which
// only `owner` and `supervisor` hold (per the RBAC matrix).
export async function updateFacility(data: FacilityUpdateData) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const roleKey = dbRoleToRoleKey(session.user.role);
    if (!roleKey) {
      logger.warn({
        msg: '[facility] updateFacility: unknown or stale role — denying',
        userId: session.user.id,
        role: session.user.role,
      });
      return { success: false, error: 'Forbidden' };
    }
    if (!can(roleKey, 'facility.edit')) {
      logger.warn({
        msg: '[facility] updateFacility: permission denied',
        userId: session.user.id,
        role: session.user.role,
      });
      return { success: false, error: 'Forbidden' };
    }

    const membershipFacility = session.user.organizationUserId
      ? await prisma.organizationUserFacility.findFirst({
          where: { organizationUserId: session.user.organizationUserId, active: true },
          select: { facilityId: true },
        })
      : null;

    if (!membershipFacility) {
      logger.error({
        msg: '[facility] updateFacility: no facility for user',
        userId: session.user.id,
      });
      return { success: false, error: 'No facility found' };
    }

    await prisma.facility.update({
      where: { id: membershipFacility.facilityId },
      data: {
        name: data.name,
        type: data.type,
        staffCount: data.staffCount,
        phone: data.phone,
        address: data.address,
        city: data.city,
        country: data.country,
        state: data.state,
        zipCode: data.zipCode,
        licenseNumber: data.licenseNumber,
        programServices: data.programServices ?? undefined,
        complianceDocumentUrl: data.complianceDocumentUrl,
        complianceDocumentName: data.complianceDocumentName,
      },
    });

    logger.info({
      msg: '[facility] Facility updated',
      facilityId: membershipFacility.facilityId,
      userId: session.user.id,
    });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error updating facility:', err: error });
    return { success: false, error: 'Failed to update facility' };
  }
}

export interface SupervisorOption {
  organizationUserId: string;
  fullName: string | null;
  email: string;
}

/**
 * The organization's existing supervisors, offered as autocomplete options when
 * picking who will run a new facility. Gated on `facility.create` so the roster
 * (which carries staff emails) is only readable by the audience that already
 * sees the create-facility form.
 */
export async function getSupervisorOptions(): Promise<{
  success: boolean;
  error?: string;
  options: SupervisorOption[];
}> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated', options: [] };
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return { success: false, error: 'No organization found', options: [] };
    }

    if (!can(dbRoleToRoleKey(session.user.role), 'facility.create')) {
      logger.warn({
        msg: '[org] getSupervisorOptions: permission denied',
        userId: session.user.id,
        role: session.user.role,
      });
      return {
        success: false,
        error: 'You do not have permission to view supervisors.',
        options: [],
      };
    }

    const rows = await prisma.organizationUser.findMany({
      where: { organizationId, active: true, role: 'supervisor' },
      select: { id: true, user: { select: { fullName: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    });

    return {
      success: true,
      options: rows.map((row) => ({
        organizationUserId: row.id,
        fullName: row.user.fullName,
        email: row.user.email,
      })),
    };
  } catch (error) {
    logger.error({ msg: '[org] Failed to load supervisor options', err: error });
    return { success: false, error: 'Failed to load supervisors', options: [] };
  }
}

const createFacilitySchema = z.object({
  name: z.string().trim().min(1, 'Facility name is required').max(200),
  // A facility may serve several programmes, but `Facility.type` is a single
  // free-form column: the selected labels (plus any "Other" free text) are
  // joined here rather than modelled as a relation.
  types: z
    .array(z.string().trim().min(1).max(200))
    .min(1, 'Select at least one facility type')
    .max(12, 'Select at most 12 facility types'),
  address: z.string().trim().max(500).optional(),
  // Blank is a first-class choice — the modal's copy is "leave empty if you'll
  // manage it yourself" — so an empty string must not fail email validation.
  supervisorEmail: z
    .union([z.string().email('Enter a valid supervisor email'), z.literal('')])
    .optional(),
});

export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;

/**
 * Add a facility to the caller's organization, optionally handing it to a
 * supervisor. Gated on `facility.create` (Owner/Admin only per the RBAC matrix).
 *
 * The supervisor may already be a member — then they are assigned to the new
 * facility outright — or a stranger, who is invited. A member holding a
 * different role is rejected before anything is written, because silently
 * re-roling someone from a facility form would be a privilege change made
 * outside Staff Management.
 *
 * The invite is best-effort: a facility that exists without its supervisor
 * invite is recoverable from the staff screen, whereas failing the whole action
 * would leave the admin unable to tell whether the facility was created.
 */
export async function createFacility(input: CreateFacilityInput): Promise<{
  success: boolean;
  error?: string;
  facilityId?: string;
  supervisorInvited?: boolean;
  supervisorAssigned?: boolean;
}> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return { success: false, error: 'No organization found' };
    }

    if (!can(dbRoleToRoleKey(session.user.role), 'facility.create')) {
      logger.warn({
        msg: '[org] createFacility: permission denied',
        userId: session.user.id,
        role: session.user.role,
      });
      return { success: false, error: 'You do not have permission to create facilities.' };
    }

    const parsed = createFacilitySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid facility details',
      };
    }

    const { name, types, address } = parsed.data;
    const type = types.join(', ');
    const supervisorEmail = parsed.data.supervisorEmail?.trim().toLowerCase() || undefined;

    // Resolved before the facility is written so a role conflict fails fast
    // rather than leaving an orphaned facility behind an error message.
    const supervisorMembership = supervisorEmail
      ? await prisma.organizationUser.findFirst({
          where: { organizationId, active: true, user: { email: supervisorEmail } },
          select: { id: true, role: true },
        })
      : null;

    if (supervisorMembership && supervisorMembership.role !== 'supervisor') {
      logger.warn({
        msg: '[org] createFacility: supervisor candidate holds another role',
        orgId: organizationId,
        userId: session.user.id,
        role: supervisorMembership.role,
      });
      return {
        success: false,
        error:
          `That person is already a member of this organization as ` +
          `${getRoleDisplayName(supervisorMembership.role)}. Change their role in Staff ` +
          `Management before assigning them as a facility supervisor.`,
      };
    }

    const facility = await prisma.facility.create({
      data: { organizationId, name, type, address },
      select: { id: true },
    });

    logger.info({
      msg: '[org] Facility created',
      orgId: organizationId,
      facilityId: facility.id,
      userId: session.user.id,
    });

    await audit({
      action: 'org.facility.create',
      actorId: session.user.id,
      actorRole: session.user.role,
      organizationId,
      targetType: 'facility',
      targetId: facility.id,
      ...getClientContext(await headers()),
    });

    let supervisorInvited = false;
    let supervisorAssigned = false;

    if (supervisorMembership) {
      // Mirrors createMembership's facility upsert: re-assigning a previously
      // removed supervisor reactivates the row instead of duplicating it.
      await prisma.organizationUserFacility.upsert({
        where: {
          organizationUserId_facilityId: {
            organizationUserId: supervisorMembership.id,
            facilityId: facility.id,
          },
        },
        create: { organizationUserId: supervisorMembership.id, facilityId: facility.id },
        update: { active: true, deactivatedAt: null },
      });
      supervisorAssigned = true;

      logger.info({
        msg: '[org] Facility supervisor assigned',
        orgId: organizationId,
        facilityId: facility.id,
        userId: session.user.id,
      });

      await audit({
        action: 'org.facility.supervisor.assign',
        actorId: session.user.id,
        actorRole: session.user.role,
        organizationId,
        targetType: 'facility',
        targetId: facility.id,
        metadata: { organizationUserId: supervisorMembership.id },
        ...getClientContext(await headers()),
      });
    } else if (supervisorEmail) {
      const invite = await createInvites([{ email: supervisorEmail, role: 'supervisor' }], {
        facilityId: facility.id,
      });
      supervisorInvited = invite.success && invite.results.some((r) => r.status === 'sent');
      if (!supervisorInvited) {
        logger.warn({
          msg: '[org] Facility supervisor invite not sent',
          facilityId: facility.id,
          email: maskEmail(supervisorEmail),
          error: invite.error,
        });
      }
    }

    revalidatePath('/dashboard/settings');
    return { success: true, facilityId: facility.id, supervisorInvited, supervisorAssigned };
  } catch (error) {
    logger.error({ msg: '[org] Failed to create facility', err: error });
    return { success: false, error: 'Failed to create facility' };
  }
}

interface OrganizationCreationData {
  legalName: string;
  primaryContactEmail: string;
  dba?: string;
  ein?: string;
  staffCount?: string;
  primaryContactName?: string;
  phone?: string;
  country?: string;
  streetAddress?: string;
  zipCode?: string;
  state?: string;
}

// Create a new organization (used during onboarding Step 1)
export async function createOrganization(data: OrganizationCreationData) {
  logger.info({ msg: '[org] createOrganization start' });
  try {
    const session = await auth();
    if (!session?.user?.id) {
      logger.error({ msg: '[org] createOrganization: no authenticated user' });
      return { success: false, error: 'Not authenticated' };
    }
    const userId = session.user.id;

    // One organisation per user — a user already in an org cannot create another.
    const existingMembership = await prisma.organizationUser.findFirst({
      where: { userId, active: true },
      select: { id: true },
    });
    if (existingMembership) {
      logger.warn({ msg: '[org] createOrganization: user already in an organization', userId });
      return {
        success: false,
        error: 'You already belong to an organization and cannot create another.',
      };
    }

    if (!data.legalName || !data.primaryContactEmail) {
      logger.warn({ msg: '[org] createOrganization: missing required fields', userId });
      return { success: false, error: 'Missing required fields' };
    }

    const existingOrg = await prisma.organization.findFirst({
      where: {
        name: {
          equals: data.legalName,
          mode: 'insensitive',
        },
      },
    });

    if (existingOrg) {
      logger.info({ msg: '[org] createOrganization: duplicate name rejected', userId });
      return {
        success: false,
        error: 'Organization with this name already exists. Please contact your admin for access.',
      };
    }

    const { orgId, facilityId } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: data.legalName,
          dba: data.dba,
          ein: data.ein,
          primaryContact: data.primaryContactName,
          primaryEmail: data.primaryContactEmail,
          slug: `${data.legalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(4).toString('hex')}`,
          isHipaaCompliant: false,
        },
      });

      // The organisation's first facility carries the location + timezone fields.
      const facility = await tx.facility.create({
        data: {
          organizationId: org.id,
          name: data.legalName,
          staffCount: data.staffCount,
          phone: data.phone,
          country: data.country,
          address: data.streetAddress,
          zipCode: data.zipCode,
          state: data.state,
          timezone: deriveTimezoneFromState(data.state),
        },
      });

      return { orgId: org.id, facilityId: facility.id };
    });

    // Link user to this new org + facility as its owner (founder).
    await createMembership({ userId, organizationId: orgId, facilityId, role: 'owner' });

    logger.info({ msg: '[org] Organization created', orgId, userId });
    logger.info({ msg: '[org] User linked to new org as owner', userId, orgId });

    return { success: true, organizationId: orgId };
  } catch (error) {
    logger.error({ msg: 'Error creating organization:', err: error });
    return { success: false, error: 'Failed to create organization' };
  }
}

export async function checkOrganizationNameAvailable(name: string) {
  try {
    const existingOrg = await prisma.organization.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
      },
    });

    return { available: !existingOrg };
  } catch (error) {
    logger.error({ msg: 'Error checking organization name:', err: error });
    return { available: false, error: 'Failed to check organization name' };
  }
}

export async function uploadComplianceDocument(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const file = formData.get('file') as File;
  if (!file) {
    return { success: false, error: 'No file provided' };
  }

  // Validate file size (e.g., 10MB)
  if (file.size > 10 * 1024 * 1024) {
    return { success: false, error: 'File size too large. Max 10MB.' };
  }

  try {
    // Compliance documents now live on the facility — gate on `facility.edit`
    // (owner + supervisor only).
    const roleKey = dbRoleToRoleKey(session.user.role);
    if (!can(roleKey, 'facility.edit')) {
      return { success: false, error: 'Unauthorized to upload facility documents' };
    }

    const organizationId = session.user.organizationId;
    const membershipFacility = session.user.organizationUserId
      ? await prisma.organizationUserFacility.findFirst({
          where: { organizationUserId: session.user.organizationUserId, active: true },
          select: { facilityId: true },
        })
      : null;

    if (!organizationId || !membershipFacility) {
      return { success: false, error: 'No facility found' };
    }

    const { uploadFile } = await import('@/lib/storage');
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const key = `organizations/${organizationId}/compliance/${timestamp}-${safeName}`;
    const { storageUri } = await uploadFile(key, buffer, file.type || 'application/pdf');

    // Persist onto the facility so the reference survives a page refresh.
    await prisma.facility.update({
      where: { id: membershipFacility.facilityId },
      data: { complianceDocumentUrl: storageUri, complianceDocumentName: file.name },
    });

    logger.info({
      msg: '[facility] Compliance document uploaded',
      facilityId: membershipFacility.facilityId,
      userId: session.user.id,
      filename: file.name,
    });
    return { success: true, url: storageUri, filename: file.name };
  } catch (error) {
    logger.error({ msg: 'Failed to upload compliance document:', err: error });
    return { success: false, error: 'Failed to upload document' };
  }
}
