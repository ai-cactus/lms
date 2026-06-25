'use client';

import { useState, useEffect, useTransition } from 'react';
import { Search, UserPlus, Download } from 'lucide-react';
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
import type { AuditorStaffRow } from '@/app/actions/auditor';

export default function AuditorStaffTab() {
  const [staff, setStaff] = useState<AuditorStaffRow[]>([]);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const { startExport } = useExportJobs();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        const data = await getAuditorStaff(search || undefined);
        setStaff(data);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="rounded-xl border border-border bg-background p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-foreground">Staff Progress</h2>
        <div className="flex items-center gap-2.5">
          <Input
            type="search"
            className="h-11 w-full sm:w-[220px]"
            placeholder="Search staff..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search staff members"
            startIcon={<Search aria-hidden="true" />}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => startExport({ scope: 'org', label: 'All staff report' })}
            title="Export all (PDF)"
          >
            <Download className="size-3.5" />
            Export all
          </Button>
        </div>
      </div>

      {isPending && staff.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-sm text-text-tertiary">Loading staff&hellip;</p>
        </div>
      ) : staff.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-primary/10">
            <UserPlus className="size-10 text-primary" aria-hidden="true" />
          </div>
          <p className="mb-1.5 text-base font-semibold text-foreground">No staff found.</p>
          <p className="text-sm text-text-tertiary">
            {search ? 'No staff match your search.' : 'No staff members in your organization yet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent border-0">
                <TableHead>Name</TableHead>
                <TableHead>Courses Assigned</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-bold text-primary"
                        aria-hidden
                      >
                        {member.name[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-foreground">{member.name}</div>
                        <div className="text-xs text-text-tertiary">{member.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{member.coursesAssigned}</TableCell>
                  <TableCell className="font-bold text-foreground">
                    {member.coursesCompleted}
                  </TableCell>
                  <TableCell className="text-[13px] text-text-secondary">
                    {member.lastActivity
                      ? member.lastActivity.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() =>
                        startExport({
                          scope: 'staff',
                          scopeId: member.id,
                          label: `Staff: ${member.name}`,
                        })
                      }
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      Export
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
