const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('--- USERS ---');
        const users = await prisma.user.findMany({
            include: {
                organization: true
            }
        });

        if (users.length === 0) {
            console.log('No users found.');
        } else {
            users.forEach(u => {
                console.log(`ID: ${u.id}`);
                console.log(`Email: ${u.email}`);
                console.log(`Role: ${u.role}`);
                console.log(`Org ID: ${u.organizationId}`);
                console.log(`Org Name: ${u.organization?.name || 'N/A'}`);
                console.log('-------------------');
            });
        }

        console.log('\n--- ORGANIZATIONS ---');
        const orgs = await prisma.organization.findMany();
        if (orgs.length === 0) {
            console.log('No organizations found.');
        } else {
            orgs.forEach(o => {
                console.log(`ID: ${o.id}, Name: ${o.name}, Slug: ${o.slug}`);
            });
        }

    } catch (error) {
        console.error('Error inspecting DB:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
