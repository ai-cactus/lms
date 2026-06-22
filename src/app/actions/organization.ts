'use server';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

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

    // Get user's organization
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true, role: true },
    });

    if (!user?.organizationId) {
      logger.error({ msg: '[org] updateOrganization: no org for user', userId: session.user.id });
      return { success: false, error: 'No organization found' };
    }

    // Only admins can update organization
    if (user.role !== 'admin') {
      logger.warn({
        msg: '[org] updateOrganization: non-admin attempt',
        userId: session.user.id,
        role: user.role,
      });
      return { success: false, error: 'Only admins can update organization' };
    }

    // Update organization
    await prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        name: data.name,
        dba: data.dba,
        ein: data.ein,
        staffCount: data.staffCount,
        primaryContact: data.primaryContact,
        primaryEmail: data.primaryEmail,
        phone: data.phone,
        address: data.address,
        city: data.city,
        country: data.country,
        state: data.state,
        zipCode: data.zipCode,
        licenseNumber: data.licenseNumber,
        isHipaaCompliant: data.isHipaaCompliant,
        primaryBusinessType: data.primaryBusinessType,
        additionalBusinessTypes: data.additionalBusinessTypes || [],
        programServices: data.programServices || [],
        complianceDocumentUrl: data.complianceDocumentUrl,
        complianceDocumentName: data.complianceDocumentName,
      },
    });

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
      include: { organization: true },
    });

    if (!user?.organization) {
      return { success: false, error: 'No organization found', data: null };
    }

    return { success: true, data: user.organization };
  } catch (error) {
    logger.error({ msg: 'Error fetching organization:', err: error });
    return { success: false, error: 'Failed to fetch organization', data: null };
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

    const org = await prisma.organization.create({
      data: {
        name: data.legalName,
        dba: data.dba,
        ein: data.ein,
        staffCount: data.staffCount,
        primaryContact: data.primaryContactName,
        primaryEmail: data.primaryContactEmail,
        phone: data.phone,
        country: data.country,
        address: data.streetAddress,
        zipCode: data.zipCode,
        state: data.state,
        slug: `${data.legalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(4).toString('hex')}`,
        isHipaaCompliant: false,
      },
    });
    logger.info({ msg: '[org] Organization created', orgId: org.id, userId });

    // Link user to this new org as Admin
    await prisma.user.update({
      where: { id: userId },
      data: {
        organizationId: org.id,
        role: 'admin',
      },
    });
    logger.info({ msg: '[org] User linked to new org as admin', userId, orgId: org.id });

    return { success: true, organizationId: org.id };
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
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true, role: true },
    });

    if (!user?.organizationId || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized to upload organization documents' };
    }

    const { uploadFile } = await import('@/lib/storage');
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const key = `organizations/${user.organizationId}/compliance/${timestamp}-${safeName}`;
    const { storageUri } = await uploadFile(key, buffer, file.type || 'application/pdf');

    logger.info({
      msg: '[org] Compliance document uploaded',
      orgId: user.organizationId,
      userId: session.user.id,
      filename: file.name,
    });
    return { success: true, url: storageUri, filename: file.name };
  } catch (error) {
    logger.error({ msg: 'Failed to upload compliance document:', err: error });
    return { success: false, error: 'Failed to upload document' };
  }
}
