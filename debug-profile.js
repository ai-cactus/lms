require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const email = 'oluwafisayo8888@gmail.com';
    console.log(`Checking for user: ${email}`);

    const user = await prisma.user.findUnique({
        where: { email },
        include: { profile: true }
    });

    if (!user) {
        console.log('User not found!');
        return;
    }

    console.log('User found:', { id: user.id, email: user.email });

    const profileByEmail = await prisma.profile.findUnique({
        where: { email },
    });

    if (profileByEmail) {
        console.log('Profile found by email:', {
            id: profileByEmail.id,
            email: profileByEmail.email,
            userIdMatch: profileByEmail.id === user.id
        });

        if (profileByEmail.id !== user.id) {
            console.error('MISMATCH DETECTED: Profile ID does not match User ID!');
            console.log('This prevents creating a new profile with the correct ID because email is unique.');
        } else {
            console.log('Profile ID matches User ID. Updates should work.');
        }
    } else {
        console.log('No profile found by email.');
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
