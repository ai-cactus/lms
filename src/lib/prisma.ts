// Re-export of the single Prisma client defined in `@/db`. Everything that
// imports `@/lib/prisma` shares that one HMR-safe, pool-tuned instance —
// there is no second client or connection pool.
import { prisma } from '@/db/index';

export default prisma;
