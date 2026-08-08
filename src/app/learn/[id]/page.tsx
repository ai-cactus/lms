import { notFound, redirect } from 'next/navigation';
import { getLearnPayload, isLearnPayloadError } from '@/lib/learn/get-learn-payload';
import LearnClient from './LearnClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function LearnPage(props: PageProps) {
  const params = await props.params;
  const payload = await getLearnPayload(params.id);

  if (isLearnPayloadError(payload)) {
    if (payload.status === 401) {
      redirect('/login');
    }
    // 403 and 404 collapse into the same answer on purpose: a learner who may
    // not open this course must not be able to tell whether it exists.
    if (payload.status === 403 || payload.status === 404) {
      notFound();
    }
    // Anything else is a server-side fault, not an access decision. Fall through
    // to the client fetch so a transient failure degrades to the pre-SSR
    // behaviour (retry on mount, then the inline error) instead of a hard 404.
    return <LearnClient />;
  }

  return <LearnClient initialData={payload} />;
}
