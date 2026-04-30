/**
 * GET /api/system/worker
 *
 * Starts the manual-indexer BullMQ worker if it isn't already running.
 * Called from the system layout on first render so the worker boots
 * alongside the application without needing a separate process.
 *
 * This endpoint is system-admin gated — anonymous callers receive 401.
 */

import { NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { getManualIndexerWorker } from '@/lib/queue/manual-indexer-worker';
import { logger } from '@/lib/logger';

export async function GET() {
  const isAuth = await verifySystemAdminCookie();
  if (!isAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const worker = getManualIndexerWorker();
    logger.info({ msg: '[WorkerStart] Manual indexer worker ensured', running: !worker.closing });

    return NextResponse.json({ status: 'running' });
  } catch (err) {
    logger.error({ msg: '[WorkerStart] Failed to start worker', err });
    return NextResponse.json({ error: 'Failed to start worker' }, { status: 500 });
  }
}
