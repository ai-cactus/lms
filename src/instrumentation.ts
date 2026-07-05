export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Import Node-only modules lazily inside the runtime guard. A top-level
    // import would pull the Prisma client (which loads `node:path`/`node:process`)
    // into the Edge runtime bundle and trigger an unsupported-module warning,
    // even though this code only ever runs under the Node.js runtime.
    const { logger } = await import('@/lib/logger');
    const { default: prisma } = await import('@/lib/prisma');

    // F-042: Fail fast on missing required env vars at process start.
    // No-ops under test/CI/build (see validateEnv's carve-out).
    const { validateEnv } = await import('@/lib/env');
    validateEnv();

    const cleanup = async (signal: string) => {
      logger.info({ msg: `Received ${signal}, shutting down gracefully...` });

      try {
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
