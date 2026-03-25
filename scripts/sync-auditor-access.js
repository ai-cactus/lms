/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting auditor access synchronization...');

  // 1. Find organizations that SHOULD have access but don't
  const toGrant = await prisma.organization.findMany({
    where: {
      hasAuditorAccess: false,
      subscription: {
        status: { in: ['active', 'trialing'] }
      }
    },
    select: { id: true, name: true }
  });

  console.log(`Found ${toGrant.length} organizations to grant access to.`);

  for (const org of toGrant) {
    console.log(`Granting access to: ${org.name} (${org.id})`);
    await prisma.organization.update({
      where: { id: org.id },
      data: { hasAuditorAccess: true }
    });
  }

  // 2. Find organizations that SHOULD NOT have access but do (optional safety check)
  const toRevoke = await prisma.organization.findMany({
    where: {
      hasAuditorAccess: true,
      OR: [
        { subscription: null },
        { subscription: { status: { notIn: ['active', 'trialing'] } } }
      ]
    },
    select: { id: true, name: true }
  });

  console.log(`Found ${toRevoke.length} organizations to revoke access from.`);

  for (const org of toRevoke) {
    console.log(`Revoking access from: ${org.name} (${org.id})`);
    await prisma.organization.update({
      where: { id: org.id },
      data: { hasAuditorAccess: false }
    });
  }

  console.log('Synchronization complete.');

  if (toGrant.length === 0) {
    console.log('\n--- Debug Info: All Organizations ---');
    const allOrgs = await prisma.organization.findMany({
      include: { subscription: true },
      select: { id: true, name: true, hasAuditorAccess: true, subscription: { select: { status: true } } }
    });
    console.log(JSON.stringify(allOrgs, null, 2));
    console.log('--------------------------------------');
    console.log('TIP: If you see "subscription": null, it means the Stripe webhook never successfully saved the subscription to your database.');
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
