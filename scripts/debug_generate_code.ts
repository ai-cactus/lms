
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

    if (!user || !user.organization) {
        console.log('No user with organization found.');
        return;
    }

    console.log('Testing code generation for org:', user.organization.name);

    function generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    let code = generateCode();
    console.log('Generated code:', code);

    // Test findUnique on joinCode
    try {
        const existing = await prisma.organization.findUnique({
            where: { joinCode: code }
        });
        console.log('check existing (should be null):', existing);
    } catch (e) {
        console.error('Error checking existing code:', e);
    }

    // Try updating
    try {
        const updated = await prisma.organization.update({
            where: { id: user.organization.id },
            data: {
                joinCode: code,
                joinCodeExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000)
            }
        });
        console.log('Updated organization with code:', updated.joinCode);
    } catch (e) {
        console.error('Error updating organization:', e);
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
