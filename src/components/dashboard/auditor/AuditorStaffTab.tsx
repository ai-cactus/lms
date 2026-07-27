'use client';

import { useState, useEffect, useTransition } from 'react';
import { Search, Download } from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';
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
import { useExportJobs } from './ExportJobsProvider';
import { useAuditFilter, toRangeInput } from './AuditFilterProvider';
import type { AuditorStaffRow } from '@/app/actions/auditor';
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

export default function AuditorStaffTab() {
  const [staff, setStaff] = useState<AuditorStaffRow[]>([]);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const { startExport } = useExportJobs();
  const { range } = useAuditFilter();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        const data = await getAuditorStaff(search || undefined, toRangeInput(range));
        setStaff(data);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, range]);

  return (
    <div className={auditCard}>
      <div className={auditCardHeader}>
        <h2 className={auditCardTitle}>All Staff</h2>
        <div className="flex items-center gap-3">
          <div className={auditSearchWrap}>
            <Input
              type="search"
              className={auditSearch}
              placeholder="Search staff…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search staff members"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>
          <Button
            variant="outline"
            className={auditOutlineButton}
            onClick={() =>
              startExport({ scope: 'all-staff', label: 'All staff report', ...toRangeInput(range) })
            }
            title="Export all (PDF)"
          >
            <Download className="size-3.5" />
            Export all
          </Button>
        </div>
      </div>

      {isPending && staff.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[14px] text-[#64748b]">Loading staff&hellip;</p>
        </div>
      ) : staff.length === 0 ? (
        <EmptyTableState
          message={search ? 'No Results' : 'No staff found.'}
          subMessage={
            search
              ? `No results matching ‘${search}’`
              : 'No staff members in your organization yet.'
          }
        />
      ) : (
        <Table>
          <TableHeader className={auditHeaderGroup}>
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead className={cn(auditHead, 'w-full sm:w-[360px]')}>Staff</TableHead>
              <TableHead className={cn(auditHead, 'hidden sm:table-cell sm:w-[170px]')}>
                Assigned
              </TableHead>
              <TableHead className={cn(auditHead, 'hidden md:table-cell md:w-[170px]')}>
                Completed
              </TableHead>
              <TableHead className={cn(auditHead, 'hidden lg:table-cell lg:w-[200px]')}>
                Last Activity
              </TableHead>
              <TableHead className={auditHead}>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((member) => (
              <TableRow key={member.id} className={auditRow}>
                <TableCell className={auditCell}>
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-[12px] font-semibold text-[#475569]"
                      aria-hidden
                    >
                      {initials(member.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[15.5px] font-medium tracking-[0.31px] text-[#1e1e1e]">
                        {member.name}
                      </div>
                      <div className="truncate text-[12px] leading-4 text-[#94a3b8]">
                        {member.email}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn(auditCell, 'hidden sm:table-cell')}>
                  {member.coursesAssigned}
                </TableCell>
                <TableCell className={cn(auditCell, 'hidden font-semibold md:table-cell')}>
                  {member.coursesCompleted}
                </TableCell>
                <TableCell
                  className={cn(auditCell, 'hidden whitespace-nowrap text-[#64748b] lg:table-cell')}
                >
                  {member.lastActivity
                    ? member.lastActivity.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—'}
                </TableCell>
                <TableCell className={auditCell}>
                  <button
                    type="button"
                    onClick={() =>
                      startExport({
                        scope: 'staff',
                        scopeId: member.id,
                        label: `Staff: ${member.name}`,
                        ...toRangeInput(range),
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
      )}
    </div>
  );
}
