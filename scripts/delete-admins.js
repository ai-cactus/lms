const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Finding admins to delete...');
        const admins = await prisma.user.findMany({
            where: {
                role: 'admin'
            }
        });

        console.log(`Found ${admins.length} admins.`);

        if (admins.length > 0) {
            const deleteResult = await prisma.user.deleteMany({
                where: {
                    role: 'admin'
                }
            });
            console.log(`Successfully deleted ${deleteResult.count} admins.`);
        } else {
            console.log('No admins found.');
        }

    } catch (error) {
        console.error('Error deleting admins:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
