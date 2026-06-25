import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

interface HealthCheck {
  status: 'ok' | 'unhealthy';
  database: 'connected' | 'unavailable';
  redis: 'connected' | 'unavailable' | 'not_configured';
  timestamp: string;
  uptime: number;
}

export async function GET() {
  const checks: HealthCheck = {
    status: 'ok',
    database: 'connected',
    redis: 'not_configured',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  let isHealthy = true;

  // Database check
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    checks.database = 'unavailable';
    isHealthy = false;
  }

  // Redis check
  try {
    const { rateLimiterRedis } = await import('@/lib/rate-limit');
    const pong = await rateLimiterRedis.ping();
    checks.redis = pong === 'PONG' ? 'connected' : 'unavailable';
    if (pong !== 'PONG') isHealthy = false;
  } catch {
    checks.redis = 'unavailable';
    // Redis unavailability is not fatal — the app degrades gracefully
  }

  if (!isHealthy) {
    checks.status = 'unhealthy';
    return NextResponse.json(checks, { status: 503 });
  }

  return NextResponse.json(checks);
}
