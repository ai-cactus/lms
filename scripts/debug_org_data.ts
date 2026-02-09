
import { prisma } from '../src/lib/prisma';

async function main() {
    const user = await prisma.user.findFirst({
        where: {
            organization: {
                isNot: null
            }
        },
        include: {
            organization: true
        }
    });

    if (user && user.organization) {
        console.log('User found:', user.email);
        console.log('Organization:', JSON.stringify(user.organization, null, 2));
    } else {
        console.log('No user with organization found.');
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
