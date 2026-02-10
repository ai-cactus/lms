const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Finding workers to delete...');
        const workers = await prisma.user.findMany({
            where: {
                role: 'worker'
            }
        });

        console.log(`Found ${workers.length} workers.`);

        if (workers.length > 0) {
            const deleteResult = await prisma.user.deleteMany({
                where: {
                    role: 'worker'
                }
            });
            console.log(`Successfully deleted ${deleteResult.count} workers.`);
        } else {
            console.log('No workers found.');
        }

    } catch (error) {
        console.error('Error deleting workers:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
