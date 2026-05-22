import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { redirect } from 'next/navigation';
import { logger } from '@/lib/logger';

export default async function ProfileRedirectPage() {
  let adminSession = null;
  let workerSession = null;
  try {
    adminSession = await adminAuth();
  } catch {
    /* no admin session */
  }
  try {
    workerSession = await workerAuth();
  } catch {
    /* no worker session */
  }
  const session = adminSession?.user ? adminSession : workerSession;

  if (!session?.user) {
    redirect('/');
  }

  const role = session.user.role;
  logger.info({ msg: '[ProfileRedirectPage] Accessing profile with role:', data: role });

  if (role === 'worker') {
    redirect('/worker/profile');
  } else {
    // Admin, Manager, Supervisor go to dashboard profile
    redirect('/dashboard/profile');
  }
}
