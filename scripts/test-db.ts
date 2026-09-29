import { prisma } from '@/db/index';
import { logger } from '@/lib/logger';

async function main() {
  try {
    await prisma.$connect();
    logger.info({ msg: '[test-db] Successfully connected to the database!' });
    const users = await prisma.user.findMany();
    logger.info({ msg: `[test-db] Found ${users.length} users.` });
  } catch (error) {
    logger.error({ msg: '[test-db] Failed to connect to the database', err: error });
  } finally {
    await prisma.$disconnect();
  }
}

main();
