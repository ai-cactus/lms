
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Checking for Invite model...');
    if (prisma.invite) {
        console.log('SUCCESS: prisma.invite exists!');
        // Optional: try to count
        const count = await prisma.invite.count();
        console.log(`Current invite count: ${count}`);
    } else {
        console.error('FAILURE: prisma.invite is undefined');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
