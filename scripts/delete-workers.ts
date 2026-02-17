
import { prisma } from '../src/lib/prisma';

async function main() {
    // First, find all organizations and their workers
    const orgs = await prisma.organization.findMany({
        include: {
            users: {
                where: { role: 'worker' },
                select: { id: true, email: true, role: true }
            }
        }
    });

    for (const org of orgs) {
        console.log(`\nOrg: ${org.name} (${org.id})`);
        console.log(`Workers: ${org.users.length}`);
        org.users.forEach(m => console.log(`  - ${m.email} (${m.role})`));
    }

    const allWorkers = orgs.flatMap(o => o.users);
    console.log(`\nTotal workers to delete: ${allWorkers.length}`);

    if (allWorkers.length === 0) {
        console.log('No workers found.');
        return;
    }

    const workerIds = allWorkers.map(w => w.id);

    // Delete related data first (enrollments, quiz attempts, profiles)
    console.log('\nDeleting quiz attempts...');
    const deletedAttempts = await prisma.quizAttempt.deleteMany({
        where: { enrollment: { userId: { in: workerIds } } }
    });
    console.log(`  Deleted ${deletedAttempts.count} quiz attempts`);

    console.log('Deleting enrollments...');
    const deletedEnrollments = await prisma.enrollment.deleteMany({
        where: { userId: { in: workerIds } }
    });
    console.log(`  Deleted ${deletedEnrollments.count} enrollments`);

    console.log('Deleting profiles...');
    const deletedProfiles = await prisma.profile.deleteMany({
        where: { user: { id: { in: workerIds } } }
    });
    console.log(`  Deleted ${deletedProfiles.count} profiles`);

    console.log('Deleting workers...');
    const deletedUsers = await prisma.user.deleteMany({
        where: { id: { in: workerIds } }
    });
    console.log(`  Deleted ${deletedUsers.count} workers`);

    console.log('\nDone!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
