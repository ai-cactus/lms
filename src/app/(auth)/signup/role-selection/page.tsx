import { redirect } from 'next/navigation';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import RoleSelectionClient from './RoleSelectionClient';

/**
 * Server guard for the public role-selection step.
 *
 * The legitimate email/password signup flow reaches this page while
 * unauthenticated (role is still being chosen), so it renders the client UI.
 * After an OAuth (MS SSO) round-trip, however, the user is already
 * authenticated with a role — they must never be shown the public signup or
 * bounced back to `/signup` by the client-side `pendingSignup` check. We
 * redirect authenticated users to their correct destination instead.
 */
export default async function RoleSelectionPage() {
  const [adminSession, workerSession] = await Promise.all([adminAuth(), workerAuth()]);

  if (adminSession?.user?.id) {
    // Admins with an org go to the dashboard; admins still without one need onboarding.
    redirect(adminSession.user.organizationId ? '/dashboard' : '/onboarding');
  }

  if (workerSession?.user?.id) {
    redirect('/worker');
  }

  return <RoleSelectionClient />;
}
