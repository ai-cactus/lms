
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const email = 'oluwafisayo8888@gmail.com';
    console.log(`Checking user role for: ${email}`);

    const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, organizationId: true, role: true }
    });

    if (!user) {
        console.log('User not found!');
    } else {
        console.log('User found:', user);
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
