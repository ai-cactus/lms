import { prisma } from '../src/lib/prisma';

async function main() {
    const enrollments = await prisma.enrollment.findMany({
        where: {
            user: { email: 'nopermx00@gmail.com' }
        },
        include: { course: true }
    });
    console.log(JSON.stringify(enrollments, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
