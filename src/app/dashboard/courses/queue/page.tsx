import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { auth } from '@/auth';
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge';
import prisma from '@/lib/prisma';

// F-028: the Job table grows without bound, so the queue is paginated instead of
// loading every job the user has ever created on one page.
const PAGE_SIZE = 50;

interface QueuePageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function QueuePage(props: QueuePageProps) {
  const session = await auth();
  const { page: pageParam } = await props.searchParams;

  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Fetch one extra row to detect whether a next page exists without a COUNT.
  const jobs = await prisma.job.findMany({
    where: { userId: session?.user?.id },
    orderBy: { createdAt: 'desc' },
    skip,
    take: PAGE_SIZE + 1,
  });

  const hasNextPage = jobs.length > PAGE_SIZE;
  const pageJobs = hasNextPage ? jobs.slice(0, PAGE_SIZE) : jobs;

  return (
    <div className="p-8">
      <header className="mb-8">
        <h1>Job Queue</h1>
      </header>

      <div className="flex flex-col gap-4">
        {pageJobs.map((job) => (
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
        {pageJobs.length === 0 && <p className="text-gray-500">No active jobs.</p>}
      </div>

      {(page > 1 || hasNextPage) && (
        <div className="mt-8 flex items-center justify-between">
          {page > 1 ? (
            <Link
              href={`?page=${page - 1}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-secondary"
            >
              <ChevronLeft className="size-4" />
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-text-secondary">Page {page}</span>
          {hasNextPage ? (
            <Link
              href={`?page=${page + 1}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-secondary"
            >
              Next
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
