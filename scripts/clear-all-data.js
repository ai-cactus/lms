// Script to delete ALL data from the database
// This will remove: Users, Profiles, Organizations, Invites, Courses, Lessons, 
// Questions, Quizzes, Enrollments, Quiz Attempts, Documents, etc.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearAllData() {
    console.log('⚠️  WARNING: This will DELETE ALL DATA from the database!\n');

    try {
        console.log('Deleting all data...\n');

        // Delete in order of dependencies (children first, then parents)

        // Quiz attempts first (references enrollment and quiz)
        const attempts = await prisma.quizAttempt.deleteMany({});
        console.log(`✓ Deleted ${attempts.count} quiz attempts`);

        // Questions (references quiz)
        const questions = await prisma.question.deleteMany({});
        console.log(`✓ Deleted ${questions.count} questions`);

        // Quizzes (references lesson)
        const quizzes = await prisma.quiz.deleteMany({});
        console.log(`✓ Deleted ${quizzes.count} quizzes`);

        // Enrollments (references user and course)
        const enrollments = await prisma.enrollment.deleteMany({});
        console.log(`✓ Deleted ${enrollments.count} enrollments`);

        // Lessons (references course)
        const lessons = await prisma.lesson.deleteMany({});
        console.log(`✓ Deleted ${lessons.count} lessons`);

        // Course Versions (references course and document version)
        const courseVersions = await prisma.courseVersion.deleteMany({});
        console.log(`✓ Deleted ${courseVersions.count} course versions`);

        // Courses (references user)
        const courses = await prisma.course.deleteMany({});
        console.log(`✓ Deleted ${courses.count} courses`);

        // Mapping Evidence (references document version)
        const mappings = await prisma.mappingEvidence.deleteMany({});
        console.log(`✓ Deleted ${mappings.count} mapping evidence records`);

        // PHI Reports (references document version)
        const phiReports = await prisma.phiReport.deleteMany({});
        console.log(`✓ Deleted ${phiReports.count} PHI reports`);

        // Document Versions (references document)
        const docVersions = await prisma.documentVersion.deleteMany({});
        console.log(`✓ Deleted ${docVersions.count} document versions`);

        // Documents (references user)
        const documents = await prisma.document.deleteMany({});
        console.log(`✓ Deleted ${documents.count} documents`);

        // Auditor Packs
        const auditorPacks = await prisma.auditorPack.deleteMany({});
        console.log(`✓ Deleted ${auditorPacks.count} auditor packs`);

        // Jobs
        const jobs = await prisma.job.deleteMany({});
        console.log(`✓ Deleted ${jobs.count} jobs`);

        // Verification Tokens
        const verificationTokens = await prisma.verificationToken.deleteMany({});
        console.log(`✓ Deleted ${verificationTokens.count} verification tokens`);

        // Invites (references organization)
        const invites = await prisma.invite.deleteMany({});
        console.log(`✓ Deleted ${invites.count} invites`);

        // Profiles (before users due to FK, references user)
        const profiles = await prisma.profile.deleteMany({});
        console.log(`✓ Deleted ${profiles.count} profiles`);

        // Users (references organization)
        const users = await prisma.user.deleteMany({});
        console.log(`✓ Deleted ${users.count} users`);

        // Organizations (last, as users reference them)
        const orgs = await prisma.organization.deleteMany({});
        console.log(`✓ Deleted ${orgs.count} organizations`);

        console.log('\n✅ All data has been deleted successfully!');
        console.log('\n📝 You can now create fresh accounts through the signup/onboarding flow.');

    } catch (error) {
        console.error('❌ Error deleting data:', error);
    } finally {
        await prisma.$disconnect();
    }
}

clearAllData();
