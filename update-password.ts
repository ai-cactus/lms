import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'praiseomosanya250@gmail.com';
  const newPassword = 'Password123!';
  
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  
  const updatedUser = await prisma.user.update({
    where: { email },
    data: { password: hashedPassword },
  });
  
  console.log(`Password updated successfully for ${updatedUser.email}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
