'use server';

import crypto from 'crypto';
import { isAdminRole, dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { deriveTimezoneFromState } from '@/lib/reminders/us-state-timezone';

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

    // Get user's organization + facility
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true, facilityId: true, role: true },
    });

    if (!user?.organizationId) {
      logger.error({ msg: '[org] updateOrganization: no org for user', userId: session.user.id });
      return { success: false, error: 'No organization found' };
    }

    // Only admins can update organization (gate unchanged by the facility split).
    if (!isAdminRole(user.role)) {
      logger.warn({
        msg: '[org] updateOrganization: non-admin attempt',
        userId: session.user.id,
        role: user.role,
      });
      return { success: false, error: 'Only admins can update organization' };
    }

    // Org-only fields live on Organization; location/compliance fields now live
    // on the Facility. `?? undefined` avoids clobbering array columns when a
    // caller omits them (moved fields are usually saved via updateFacility).
    await prisma.organization.update({
      where: { id: user.organizationId },
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

    // Moved fields → the user's facility (if one is attached).
    if (user.facilityId) {
      await prisma.facility.update({
        where: { id: user.facilityId },
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
      orgId: user.organizationId,
      userId: session.user.id,
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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { organization: true, facility: true },
    });

    if (!user?.organization) {
      return { success: false, error: 'No organization found', data: null };
    }

    // Nested shape: facility may be null for users not yet attached to one.
    return {
      success: true,
      data: { organization: user.organization, facility: user.facility ?? null },
    };
  } catch (error) {
    logger.error({ msg: 'Error fetching organization:', err: error });
    return { success: false, error: 'Failed to fetch organization', data: null };
  }
}

interface FacilityUpdateData {
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
    if (!can(roleKey, 'facility.edit')) {
      logger.warn({
        msg: '[facility] updateFacility: permission denied',
        userId: session.user.id,
        role: session.user.role,
      });
      return { success: false, error: 'Forbidden' };
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { facilityId: true },
    });

    if (!user?.facilityId) {
      logger.error({
        msg: '[facility] updateFacility: no facility for user',
        userId: session.user.id,
      });
      return { success: false, error: 'No facility found' };
    }

    await prisma.facility.update({
      where: { id: user.facilityId },
      data: {
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
      facilityId: user.facilityId,
      userId: session.user.id,
    });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Error updating facility:', err: error });
    return { success: false, error: 'Failed to update facility' };
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
    const existingMembership = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });
    if (existingMembership?.organizationId) {
      logger.warn({ msg: '[org] createOrganization: user already in an organization', userId });
      return {
        success: false,
        error: 'You already belong to an organization and cannot create another.',
      };
    }

    // Basic validation
    if (!data.legalName || !data.primaryContactEmail) {
      logger.warn({ msg: '[org] createOrganization: missing required fields', userId });
      return { success: false, error: 'Missing required fields' };
    }

    // Check for existing organization with the same name
    const existingOrg = await prisma.organization.findFirst({
      where: {
        name: {
          equals: data.legalName,
          mode: 'insensitive', // Case insensitive check
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

    const organizationId = await prisma.$transaction(async (tx) => {
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

      // Link user to this new org + facility as its owner (founder).
      await tx.user.update({
        where: { id: userId },
        data: {
          organizationId: org.id,
          facilityId: facility.id,
          role: 'owner',
        },
      });

      return org.id;
    });

    logger.info({ msg: '[org] Organization created', orgId: organizationId, userId });
    logger.info({ msg: '[org] User linked to new org as owner', userId, orgId: organizationId });

    return { success: true, organizationId };
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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true, facilityId: true },
    });

    if (!user?.facilityId) {
      return { success: false, error: 'No facility found' };
    }

    const { uploadFile } = await import('@/lib/storage');
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const key = `organizations/${user.organizationId}/compliance/${timestamp}-${safeName}`;
    const { storageUri } = await uploadFile(key, buffer, file.type || 'application/pdf');

    // Persist onto the facility so the reference survives a page refresh.
    await prisma.facility.update({
      where: { id: user.facilityId },
      data: { complianceDocumentUrl: storageUri, complianceDocumentName: file.name },
    });

    logger.info({
      msg: '[facility] Compliance document uploaded',
      facilityId: user.facilityId,
      userId: session.user.id,
      filename: file.name,
    });
    return { success: true, url: storageUri, filename: file.name };
  } catch (error) {
    logger.error({ msg: 'Failed to upload compliance document:', err: error });
    return { success: false, error: 'Failed to upload document' };
  }
}
