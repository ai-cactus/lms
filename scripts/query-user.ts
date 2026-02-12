import { prisma } from '../src/lib/prisma';

async function main() {
    const user = await prisma.user.findUnique({
        where: { email: 'nopermx00@gmail.com' },
        include: { organization: true }
    });
    console.log(JSON.stringify(user, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
