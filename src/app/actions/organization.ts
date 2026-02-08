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
                country: data.country,
                state: data.state,
                zipCode: data.zipCode,
                licenseNumber: data.licenseNumber,
                isHipaaCompliant: data.isHipaaCompliant,
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
