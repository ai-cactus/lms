import { prisma } from '../src/lib/prisma';
import { createJob } from '../src/lib/jobs';
import { scanText } from '../src/lib/documents/phiScanner';
import { suggestMappings } from '../src/lib/mapping';

async function main() {
    console.log("Starting Verification...");

    // 1. Create Org & User
    console.log("1. Creating Organization & User...");
    const org = await prisma.organization.create({
        data: { name: "Test Org", slug: `test-org-${Date.now()}` }
    });
    const user = await prisma.user.create({
        data: {
            email: `test-${Date.now()}@example.com`,
            password: "hashed_password",
            organizationId: org.id,
            role: 'admin'
        }
    });
    console.log(`   User created: ${user.email} (${user.id})`);

    // 2. Document & PHI
    console.log("2. Testing Document Logic...");
    const text = "Patient John Doe (DOB: 01/01/1980) Policy regarding safety.";
    const phi = await scanText(text);
    console.log(`   PHI Detected: ${phi.hasPHI}`, phi.findings);

    const doc = await prisma.document.create({
        data: {
            userId: user.id,
            filename: "policy.txt",
            originalName: "policy.txt",
            mimeType: "text/plain",
            size: text.length
        }
    });

    const version = await prisma.documentVersion.create({
        data: {
            documentId: doc.id,
            version: 1,
            storagePath: "/tmp/mock",
            hash: "mock_hash",
            content: text,
        }
    });
    console.log(`   Document Version created: ${version.id}`);

    // 3. Mapping
    console.log("3. Testing Mapping Suggestions...");
    const mappings = await suggestMappings(text);
    console.log(`   Suggestions found: ${mappings.length}`);

    // 4. Job Queue -> Course Generation
    console.log("4. Testing Course Generation Job...");
    const job = await createJob('GENERATE_DRAFT', {
        documentVersionId: version.id,
        userId: user.id
    });
    console.log(`   Job Queued: ${job.id}`);

    // Wait for job (mock processing)
    console.log("   Waiting for job processing...");
    await new Promise(r => setTimeout(r, 7000));

    const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
    console.log(`   Job Status: ${updatedJob?.status}`);

    // Check Course
    const course = await prisma.course.findFirst({ where: { createdBy: user.id } });
    if (course) {
        console.log(`   SUCCESS: Course Created: "${course.title}"`);
    } else {
        console.error("   FAILURE: No course created.");
    }

    console.log("Verification Complete.");
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
