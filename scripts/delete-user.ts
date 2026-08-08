/*
 * delete-user.ts — hard-deletes one identity and everything that cascades off
 * it (memberships, enrollments, documents, certificates, notifications), plus
 * its invites, authored courses and verification tokens.
 *
 * Usage:
 *   npx tsx scripts/delete-user.ts --dry-run   # report only
 *   npx tsx scripts/delete-user.ts             # delete
 *
 * Flags:
 *   --dry-run   Report what would be deleted, write nothing.
 */
import { prisma } from '@/db/index';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const email = 'vauntedgiant@zohomail.com';
  const prefix = DRY_RUN ? '[DRY RUN] Would delete' : 'Deleted';

  const inviteCount = await prisma.invite.count({ where: { email } });
  if (!DRY_RUN) {
    await prisma.invite.deleteMany({
      where: { email },
    });
  }
  console.log(`${prefix} ${inviteCount} invite(s) for ${email}`);

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
    const courseCount = await prisma.course.count({
      where: { createdByOrgUserId: { in: organizationUserIds } },
    });
    if (!DRY_RUN) {
      await prisma.course.deleteMany({
        where: { createdByOrgUserId: { in: organizationUserIds } },
      });
    }
    console.log(`${prefix} ${courseCount} course(s) for ${email}`);

    if (!DRY_RUN) {
      await prisma.user.delete({
        where: { email },
      });
    }
    console.log(
      `${prefix} user ${email} (cascading ${organizationUserIds.length} membership(s), enrollments, and documents)`,
    );
  } else {
    console.log(`User ${email} not found`);
  }

  const tokenCount = await prisma.verificationToken.count({ where: { identifier: email } });
  if (!DRY_RUN) {
    await prisma.verificationToken.deleteMany({
      where: { identifier: email },
    });
  }
  console.log(`${prefix} ${tokenCount} verification token(s) for ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
