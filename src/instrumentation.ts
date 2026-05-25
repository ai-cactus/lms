import { logger } from '@/lib/logger';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cleanup = async (signal: string) => {
      logger.info({ msg: `Received ${signal}, shutting down gracefully...` });

      try {
        const { prisma } = await import('@/lib/prisma');
        await prisma.$disconnect();
        logger.info({ msg: 'Database disconnected' });
      } catch (err) {
        logger.error({ msg: 'Error disconnecting database', err });
      }

      process.exit(0);
    };

    process.on('SIGTERM', () => cleanup('SIGTERM'));
    process.on('SIGINT', () => cleanup('SIGINT'));
  }
}
