
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const orgName = 'Zenco HealthCare Ltd.';
    console.log(`Checking details for organization: ${orgName}`);

    const org = await prisma.organization.findFirst({
        where: { name: orgName }
    });

    if (!org) {
        console.log('Organization not found!');
        return;
    }

    console.log('Organization found:', org);
    console.log('Phone:', org.phone);
    console.log('Country:', org.country);
    console.log('Primary Contact:', org.primaryContact);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
