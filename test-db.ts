import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'oluwafisayo8888@gmail.com' } });
  console.log(user);
}
main().catch(console.error).finally(() => prisma.$disconnect());
