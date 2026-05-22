const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const nodeCrypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting backfill for empty passwords...');

  const usersWithEmptyPassword = await prisma.user.findMany({
    where: { password: '' },
  });

  console.log(`Found ${usersWithEmptyPassword.length} users with empty passwords.`);

  for (const user of usersWithEmptyPassword) {
    const randomPassword = await bcrypt.hash(nodeCrypto.randomUUID() + Date.now().toString(), 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: randomPassword,
        authProvider: 'microsoft-entra-id', // Assuming empty passwords were from OAuth
      },
    });
    console.log(`Updated user ${user.id} (${user.email})`);
  }

  console.log('Backfill complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
