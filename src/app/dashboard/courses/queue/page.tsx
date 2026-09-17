import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge';
import EmptyTableState from '@/components/ui/EmptyTableState';
import prisma from '@/lib/prisma';
import { requirePermission } from '@/lib/rbac/require-permission';

// F-028: the Job table grows without bound, so the queue is paginated instead of
// loading every job the user has ever created on one page.
const PAGE_SIZE = 50;

interface QueuePageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function QueuePage(props: QueuePageProps) {
  // Q26: was `await auth()` and no role check at all — any authenticated session,
  // every worker included, could open the job queue by typing the URL.
  //
  // `course.create`, not `course.read`: this page exists to show AI
  // course-GENERATION state, its only entry point is the pending-generation
  // banner on the Courses list, and only a role that can author a course can
  // ever produce a row here. `course.read` is held by 13 of 14 roles and would
  // readmit every worker to a page they can never populate — the same reasoning
  // that put the mapping page on `document.read`.
  const { userId } = await requirePermission('course.create', { onDeny: 'notFound' });
  const { page: pageParam } = await props.searchParams;

  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Fetch one extra row to detect whether a next page exists without a COUNT.
  const jobs = await prisma.job.findMany({
    where: { userId },
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
        {pageJobs.length === 0 && <EmptyTableState message="No active jobs." />}
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
