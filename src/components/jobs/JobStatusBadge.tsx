import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { JobStatus } from '@/types/job';

/**
 * Maps a {@link JobStatus} to a human label and a theme-token colour treatment.
 * Uses the shared status-pill tokens (tinted `bg` + matching `text`) instead of
 * raw hex so the badge stays consistent with the rest of the design system.
 */
const STATUS_CONFIG: Record<JobStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-background-secondary text-text-secondary' },
  processing: { label: 'Processing', className: 'bg-primary/15 text-primary' },
  completed: { label: 'Completed', className: 'bg-success/15 text-success' },
  failed: { label: 'Failed', className: 'bg-error/15 text-error' },
};

interface JobStatusBadgeProps {
  status: JobStatus;
  className?: string;
}

export function JobStatusBadge({ status, className }: JobStatusBadgeProps) {
  const { label, className: statusClassName } = STATUS_CONFIG[status];

  return <Badge className={cn(statusClassName, className)}>{label}</Badge>;
}
