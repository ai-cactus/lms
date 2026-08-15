import type { Worker } from 'bullmq';

/**
 * Registers OpenTelemetry tracing (Phase 3).
 *
 * OPT-IN on purpose: it runs only when OTEL_EXPORTER_OTLP_ENDPOINT is set, so
 * an environment without a collector — local dev, CI, the build — carries no
 * tracing overhead and cannot spend its startup retrying an exporter that will
 * never answer. Enabling it in production is therefore a config change, not a
 * deploy.
 *
 * Next.js instruments itself, so registering is enough to get a root span per
 * request plus render, route-handler and fetch spans. `NEXT_OTEL_VERBOSE=1`
 * adds the finer-grained ones when actually debugging something.
 *
 * Runs BEFORE the worker boot below: a failure to start tracing must never stop
 * the workers from starting, so it is wrapped and swallowed.
 */
async function registerTracing(): Promise<void> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  const { logger } = await import('@/lib/logger');
  try {
    const { registerOTel } = await import('@vercel/otel');
    registerOTel({
      // Same value the logger stamps as `service` and the collector reports as
      // service.name, so traces, metrics and logs agree on one identity.
      serviceName: process.env.OTEL_SERVICE_NAME || 'lms',
    });
    logger.info({
      msg: '[instrumentation] OpenTelemetry tracing registered',
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });
  } catch (err) {
    logger.error({ msg: '[instrumentation] Failed to register OpenTelemetry tracing', err });
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await registerTracing();

    // Import Node-only modules lazily inside the runtime guard. A top-level
    // import would pull the Prisma client (which loads `node:path`/`node:process`)
    // into the Edge runtime bundle and trigger an unsupported-module warning,
    // even though this code only ever runs under the Node.js runtime.
    const { logger } = await import('@/lib/logger');
    const { default: prisma } = await import('@/lib/prisma');

    // F-067: Register the AsyncLocalStorage-backed correlation-ID provider on
    // the Node server. Importing this module here (Node runtime only) wires
    // getCorrelationId() into the logger without dragging `node:async_hooks`
    // into the client/edge bundles that also import the logger.
    await import('@/lib/request-context');

    // F-042: Fail fast on missing required env vars at process start.
    // No-ops under test/CI/build (see validateEnv's carve-out).
    const { validateEnv } = await import('@/lib/env');
    validateEnv();

    // F-005: Boot the background BullMQ workers + cron Job Schedulers here, at
    // server startup, instead of as an import side-effect of the /system layout
    // (a force-dynamic admin page). Previously they only started when an admin
    // first opened /system, so after any restart the reminder/escalation and
    // video sweeps silently stopped running until that page was visited. Booting
    // them from `register()` makes their liveness independent of page traffic.
    //
    // These are the SAME getters the /system layout used to call — each is an
    // idempotent globalThis singleton and each sweep installs an idempotent
    // BullMQ Job Scheduler (keyed by a stable id), so this cannot double-start a
    // worker or duplicate a schedule, and it survives dev HMR. Enable flags
    // (REMINDER_SWEEP_ENABLED / VIDEO_SWEEP_ENABLED /
    // BILLING_PAUSE_SWEEP_ENABLED) are respected inside the getters — a
    // disabled sweep returns null and starts nothing.
    //
    // NOTE: this boots the workers *inside the web process*. The proper fix is a
    // dedicated worker service (tracked in docs/rebuild/); until then this at
    // least decouples worker liveness from page loads.
    const startedWorkers: Worker[] = [];
    try {
      const [
        { getManualIndexerWorker },
        { getVideoTranscodeWorker },
        { getVideoSweepWorker },
        { getReminderSweepWorker },
        { getNotificationDigestWorker },
        { getBillingPauseSweepWorker },
      ] = await Promise.all([
        import('@/lib/queue/manual-indexer-worker'),
        import('@/lib/queue/video-transcode-worker'),
        import('@/lib/queue/video-sweep-worker'),
        import('@/lib/queue/reminder-sweep-worker'),
        import('@/lib/queue/notification-digest-worker'),
        import('@/lib/queue/billing-pause-sweep-worker'),
      ]);

      for (const worker of [
        getManualIndexerWorker(),
        getVideoTranscodeWorker(),
        getVideoSweepWorker(),
        getReminderSweepWorker(),
        getNotificationDigestWorker(),
        getBillingPauseSweepWorker(),
      ]) {
        // Sweep getters return null when disabled via their enable flag.
        if (worker) startedWorkers.push(worker);
      }

      logger.info({
        msg: '[instrumentation] Background workers started at boot',
        count: startedWorkers.length,
      });
    } catch (err) {
      // A worker-boot failure must not crash the whole server boot — log and
      // continue so the web process still serves requests.
      logger.error({ msg: '[instrumentation] Failed to start background workers at boot', err });
    }

    const cleanup = async (signal: string) => {
      logger.info({ msg: `Received ${signal}, shutting down gracefully...` });

      // Best-effort: close the BullMQ workers so in-flight jobs are allowed to
      // finish and their Redis connections release before we disconnect the DB.
      // Failures here must not block the DB disconnect or process exit.
      await Promise.allSettled(
        startedWorkers.map(async (worker) => {
          try {
            await worker.close();
          } catch (err) {
            logger.error({ msg: 'Error closing background worker', err });
          }
        }),
      );

      // Analytics events are BATCHED (flushInterval 10s), so without an explicit
      // flush here every deploy discards whatever is still queued — which reads
      // in PostHog as a recurring dip in usage at each release. Bounded
      // internally, and it swallows its own errors, so it cannot block the DB
      // disconnect below.
      const { shutdownAnalytics } = await import('@/lib/analytics/server');
      await shutdownAnalytics();

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
