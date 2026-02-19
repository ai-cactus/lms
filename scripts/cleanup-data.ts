
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
    console.log('Starting data cleanup...');

    try {
        // 1. Delete all Documents (and their versions, mappings, reports via cascade if configured, otherwise manually)
        // DocumentVersion -> Document (Cascade?)
        // Let's check schema again. schema says: document Document @relation(..., onDelete: Cascade)
        // So deleting Document deletes DocumentVersion.
        // PhiReport -> DocumentVersion (Cascade). Good.
        // MappingEvidence -> DocumentVersion. No cascade specified in schema snippet provided.
        // Let's delete MappingEvidence first to be safe.

        console.log('Deleting MappingEvidence...');
        await prisma.mappingEvidence.deleteMany({});

        console.log('Deleting PhiReports...');
        await prisma.phiReport.deleteMany({}); // Should cascade but safe to do

        console.log('Deleting DocumentVersions...');
        await prisma.documentVersion.deleteMany({}); // Should cascade but safe to do

        console.log('Deleting Documents...');
        const { count: docCount } = await prisma.document.deleteMany({});
        console.log(`Deleted ${docCount} documents.`);

        // 2. Delete all Enrollments (and QuizAttempts via cascade)
        // Enrollment -> Course (No cascade)
        // Enrollment -> User (No cascade)
        // QuizAttempt -> Enrollment (Cascade). Good.
        console.log('Deleting Enrollments...');
        const { count: enrollCount } = await prisma.enrollment.deleteMany({});
        console.log(`Deleted ${enrollCount} enrollments.`);

        // 3. Delete all Courses (and Lessons, Quizzes, Questions, CourseVersions)
        // Lesson -> Course (Cascade)
        // Quiz -> Lesson (Cascade)
        // Question -> Quiz (Cascade)
        // CourseVersion -> Course (Cascade)
        console.log('Deleting Courses...');
        const { count: courseCount } = await prisma.course.deleteMany({});
        console.log(`Deleted ${courseCount} courses.`);

        // 4. Delete Workers (and Profiles)
        // Profile -> User (Cascade)
        // Invite -> Organization.
        // We only want to delete Users where role is 'worker'.
        // Admins and Org owners should stay.
        // Schema says: role String @default("worker") // 'admin' | 'worker'

        console.log('Deleting Workers...');
        const { count: workerCount } = await prisma.user.deleteMany({
            where: {
                role: 'worker'
            }
        });
        console.log(`Deleted ${workerCount} workers.`);

        console.log('Cleanup complete.');
    } catch (error) {
        console.error('Error during cleanup:', error);
    } finally {
        await prisma.$disconnect();
    }
}

cleanup();
