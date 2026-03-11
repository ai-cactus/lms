const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const jsDate = new Date();
  const dbResult = await prisma.$queryRaw`SELECT NOW() as now`;
  console.log("JS Time:", jsDate.toISOString());
  console.log("DB Time:", dbResult[0].now.toISOString());
  
  const diff = Math.abs(jsDate.getTime() - dbResult[0].now.getTime());
  console.log("Difference in minutes:", diff / 1000 / 60);
}

main().catch(console.error).finally(() => prisma.$disconnect());
