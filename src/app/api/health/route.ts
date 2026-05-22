import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Simple DB ping to ensure Prisma is connected and responsive
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', database: 'connected' });
  } catch {
    return NextResponse.json({ status: 'unhealthy' }, { status: 500 });
  }
}
