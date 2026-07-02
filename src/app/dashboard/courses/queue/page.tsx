import { auth } from '@/auth';
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge';
import prisma from '@/lib/prisma';

export default async function QueuePage() {
  const session = await auth();
  const jobs = await prisma.job.findMany({
    where: { userId: session?.user?.id },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="p-8">
      <header className="mb-8">
        <h1>Job Queue</h1>
      </header>

      <div className="flex flex-col gap-4">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center justify-between rounded-md border border-border bg-white p-6"
          >
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-foreground">{job.type.replace('_', ' ')}</span>
              <span className="text-sm text-text-secondary">
                Created: {job.createdAt.toLocaleTimeString()}
              </span>
            </div>
            <JobStatusBadge status={job.status} />
          </div>
        ))}
        {jobs.length === 0 && <p className="text-gray-500">No active jobs.</p>}
      </div>
    </div>
  );
}
