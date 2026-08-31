'use client';

import { useState, useEffect, useMemo, useTransition } from 'react';
import { Search, Upload } from 'lucide-react';
import AuditEmptyState from './AuditEmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getAuditorStaff } from '@/app/actions/auditor';
import type { AuditorStaffRow } from '@/app/actions/auditor';
import { useExportJobs } from './ExportJobsProvider';
import AuditExportRangeModal, { type AuditExportRange } from './AuditExportRangeModal';
import AuditTablePagination, { AUDIT_DEFAULT_PAGE_SIZE } from './AuditTablePagination';
import {
  auditCard,
  auditCardHeader,
  auditCardTitle,
  auditCell,
  auditHead,
  auditHeaderGroup,
  auditOutlineButton,
  auditRow,
  auditRowAction,
  auditSearch,
  auditSearchWrap,
} from './audit-ui';
import { cn } from '@/lib/utils';

interface AuditorStaffTabProps {
  /** Population an "Export all" covers — every membership in the org. */
  totalStaff: number;
}

interface PendingExport {
  scopeId?: string;
  label: string;
  count: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

export default function AuditorStaffTab({ totalStaff }: AuditorStaffTabProps) {
  const [staff, setStaff] = useState<AuditorStaffRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(AUDIT_DEFAULT_PAGE_SIZE);
  const [pending, setPending] = useState<PendingExport | null>(null);
  const [isPending, startTransition] = useTransition();
  const { activeJob, startExport } = useExportJobs();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        const data = await getAuditorStaff(search || undefined);
        setStaff(data);
        setPage(1);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const visible = useMemo(
    () => staff.slice((page - 1) * pageSize, page * pageSize),
    [staff, page, pageSize],
  );

  const handleGenerate = (range: AuditExportRange) => {
    if (!pending) return;
    startExport({
      scope: pending.scopeId ? 'staff' : 'all-staff',
      scopeId: pending.scopeId,
      label: pending.label,
      entity: 'staff',
      count: pending.count,
      ...range,
    });
    setPending(null);
  };

  return (
    <div className={auditCard}>
      <div className={auditCardHeader}>
        <h2 className={auditCardTitle}>All Staffs</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className={auditSearchWrap}>
            <Input
              type="search"
              className={auditSearch}
              placeholder="Search staffs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search staff members"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>
          <Button
            variant="outline"
            className={cn(auditOutlineButton, 'shrink-0 text-primary')}
            disabled={Boolean(activeJob)}
            onClick={() => setPending({ label: 'All staff report', count: totalStaff })}
          >
            <Upload className="size-3.5" />
            Export all
          </Button>
        </div>
      </div>

      {isPending && staff.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[14px] text-[#64748b]">Loading staff&hellip;</p>
        </div>
      ) : staff.length === 0 ? (
        <AuditEmptyState
          message={search ? 'No Results' : 'No staff yet.'}
          subMessage={
            search
              ? `No results matching ‘${search}’`
              : 'Staff will appear here once they are added to your organization.'
          }
        />
      ) : (
        <>
          {/* table-fixed keeps long names/emails from setting a min-content width
              that scrolls the table sideways: every other column is sized
              explicitly and the flexible Staff column absorbs the rest,
              truncating instead of pushing. */}
          <Table className="table-fixed">
            <TableHeader className={auditHeaderGroup}>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead className={auditHead}>Staff</TableHead>
                <TableHead className={cn(auditHead, 'hidden @lg:table-cell @lg:w-[220px]')}>
                  Department/Role
                </TableHead>
                <TableHead className={cn(auditHead, 'hidden @md:table-cell @md:w-[130px]')}>
                  Assigned
                </TableHead>
                <TableHead className={cn(auditHead, 'hidden @xl:table-cell @xl:w-[130px]')}>
                  Completed
                </TableHead>
                <TableHead className={cn(auditHead, 'hidden @3xl:table-cell @3xl:w-[190px]')}>
                  Last Completion
                </TableHead>
                <TableHead className={cn(auditHead, 'w-[92px] @md:w-[110px]')}>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((member) => (
                <TableRow key={member.id} className={auditRow}>
                  <TableCell className={auditCell}>
                    {/* min-w-0: a flex item will not shrink below its content
                        width, so without it the name/email never ellipsizes. */}
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-[12px] font-semibold text-[#475569]"
                        aria-hidden
                      >
                        {initials(member.name)}
                      </div>
                      <div className="min-w-0">
                        <div
                          className="truncate text-[15.5px] font-medium tracking-[0.31px] text-[#1e1e1e]"
                          title={member.name}
                        >
                          {member.name}
                        </div>
                        <div className="truncate text-[12px] leading-4 text-[#94a3b8]">
                          {member.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden @lg:table-cell')}>
                    <span className="line-clamp-2" title={member.roleLabel}>
                      {member.roleLabel}
                    </span>
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden @md:table-cell')}>
                    {member.coursesAssigned}
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden font-semibold @xl:table-cell')}>
                    {member.coursesCompleted}
                  </TableCell>
                  <TableCell
                    className={cn(
                      auditCell,
                      'hidden whitespace-nowrap text-[#64748b] @3xl:table-cell',
                    )}
                  >
                    {member.lastCompletion
                      ? member.lastCompletion.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </TableCell>
                  <TableCell className={auditCell}>
                    <button
                      type="button"
                      disabled={Boolean(activeJob)}
                      onClick={() =>
                        setPending({
                          scopeId: member.id,
                          label: `Staff: ${member.name}`,
                          count: 1,
                        })
                      }
                      className={auditRowAction}
                    >
                      Export
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <AuditTablePagination
            page={page}
            pageSize={pageSize}
            totalEntries={staff.length}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
            label="Staff per page"
          />
        </>
      )}

      <AuditExportRangeModal
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onGenerate={handleGenerate}
      />
    </div>
  );
}
