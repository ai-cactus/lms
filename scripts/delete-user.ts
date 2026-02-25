import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const email = 'vauntedgiant@zohomail.com'

  // delete invites
  await prisma.invite.deleteMany({
    where: { email }
  })
  console.log(`Deleted invites for ${email}`)

  // check for user
  const user = await prisma.user.findUnique({
    where: { email }
  })

  if (user) {
    // Delete relations that might be connected via cascading. 
    // Prisma schema shows that Document.userId doesn't have onCascade: Delete.
    // Course.createdBy doesn't have onCascade: Delete.
    // Enrollment.userId no cascade
    // Profile.id has onDelete: Cascade but let's delete explicitly if needed or let prisma handle it.

    await prisma.enrollment.deleteMany({
      where: { userId: user.id }
    })
    console.log(`Deleted enrollments for ${email}`)

    await prisma.document.deleteMany({
      where: { userId: user.id }
    })
    console.log(`Deleted documents for ${email}`)

    await prisma.course.deleteMany({
      where: { createdBy: user.id }
    })
    console.log(`Deleted courses for ${email}`)

    await prisma.profile.deleteMany({
      where: { id: user.id }
    })
    console.log(`Deleted profile for ${email}`)

    await prisma.user.delete({
      where: { email }
    })
    console.log(`Deleted user ${email}`)
  } else {
    console.log(`User ${email} not found`)
  }

  // delete verification tokens if there are any
  await prisma.verificationToken.deleteMany({
    where: { identifier: email }
  })
  console.log(`Deleted verification tokens for ${email}`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
