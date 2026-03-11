const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = "test@example.com";
  // Delete old
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });
  
  const token = "test-token-123";
  const start = new Date();
  const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
  
  console.log("Creating token with expiry:", expires.toISOString());
  
  const created = await prisma.verificationToken.create({
    data: {
      identifier: email,
      token,
      expires,
      type: 'email_verification'
    }
  });
  
  console.log("Created token expiry in DB:", created.expires.toISOString());
  
  const check = await prisma.verificationToken.findFirst({
    where: { token, expires: { gt: new Date() } }
  });
  
  console.log("Check with gt: new Date():", !!check);
}

main().catch(console.error).finally(() => prisma.$disconnect());
