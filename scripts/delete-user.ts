import { prisma } from '@/db/index';

async function main() {
  const email = 'vauntedgiant@zohomail.com';

  await prisma.invite.deleteMany({
    where: { email },
  });
  console.log(`Deleted invites for ${email}`);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { organizationMemberships: { select: { id: true } } },
  });

  if (user) {
    const organizationUserIds = user.organizationMemberships.map((m) => m.id);

    // Course.creator is onDelete: Restrict, so authored courses must be
    // deleted explicitly before the membership (and the user) can be removed.
    // Enrollments, documents, certificates and notifications all cascade off
    // OrganizationUser, and every OrganizationUser cascades off User, so
    // deleting the user below removes all of that automatically.
    await prisma.course.deleteMany({
      where: { createdByOrgUserId: { in: organizationUserIds } },
    });
    console.log(`Deleted courses for ${email}`);

    await prisma.user.delete({
      where: { email },
    });
    console.log(
      `Deleted user ${email} (cascaded ${organizationUserIds.length} membership(s), enrollments, and documents)`,
    );
  } else {
    console.log(`User ${email} not found`);
  }

  await prisma.verificationToken.deleteMany({
    where: { identifier: email },
  });
  console.log(`Deleted verification tokens for ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
