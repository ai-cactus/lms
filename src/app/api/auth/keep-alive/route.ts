import { auth } from '@/auth';
import { NextResponse } from 'next/server';

/**
 * Lightweight keep-alive endpoint for the admin session.
 *
 * Calling this triggers the JWT callback in create-auth-instance.ts,
 * which refreshes the `lastActivity` timestamp and checks inactivity.
 *
 * Returns `{ active: true }` if the session is still valid,
 * or 401 if the session has expired.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ active: false }, { status: 401 });
  }

  return NextResponse.json({ active: true });
}
