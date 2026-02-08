'use server';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Add userId to parameters
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
                address: data.streetAddress, // Map streetAddress to address
                zipCode: data.zipCode,
                state: data.state,
                // Generate a slug from name + random string
                slug: `${data.legalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.floor(Math.random() * 10000)}`,
                isHipaaCompliant: false // Default
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
