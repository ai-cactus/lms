'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

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
            select: { organizationId: true, role: true }
        });

        if (!user?.organizationId) {
            return { success: false, error: 'No organization found' };
        }

        // Only admins can update organization
        if (user.role !== 'admin') {
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
            }
        });

        return { success: true };
    } catch (error) {
        console.error('Error updating organization:', error);
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
            include: { organization: true }
        });

        if (!user?.organization) {
            return { success: false, error: 'No organization found', data: null };
        }

        return { success: true, data: user.organization };
    } catch (error) {
        console.error('Error fetching organization:', error);
        return { success: false, error: 'Failed to fetch organization', data: null };
    }
}

// Create a new organization (used during onboarding Step 1)
export async function createOrganization(data: any, userId?: string) {
    try {
        // Basic validation
        if (!data.legalName || !data.primaryContactEmail) {
            return { success: false, error: 'Missing required fields' };
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
                slug: `${data.legalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.floor(Math.random() * 10000)}`,
                isHipaaCompliant: false
            }
        });

        // If a userId is provided (the creator), link them to this new org as Admin
        if (userId) {
            await prisma.user.update({
                where: { id: userId },
                data: {
                    organizationId: org.id,
                    role: 'admin'
                }
            });
        }

        return { success: true, organizationId: org.id };
    } catch (error) {
        console.error('Error creating organization:', error);
        return { success: false, error: 'Failed to create organization' };
    }
}
