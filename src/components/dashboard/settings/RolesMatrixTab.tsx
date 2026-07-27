'use client';

import { Fragment } from 'react';
import { Check } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MATRIX_COLUMNS, MATRIX_ROWS, type MatrixSection } from '@/lib/rbac/roles-matrix-config';
import { cn } from '@/lib/utils';

const SECTIONS: MatrixSection[] = ['NAVIGATION', 'ACTIONS & DATA'];

const ROLE_COLUMN_CLASS = 'px-6 text-center lg:w-[116px]';

export default function RolesMatrixTab() {
  return (
    <div className="flex flex-col">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-[#101928]">System roles — platform access</h2>
        <p className="text-sm text-[#667085]">
          Access is set by the role you assign. A check means that role can see the section or
          perform the action.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#eceef2] bg-background">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow className="border-b border-solid border-[#f0f2f5] hover:bg-transparent">
              <TableHead className="h-auto bg-transparent px-6 py-3.5 text-sm leading-[22px] font-semibold text-[#667085] lg:w-[300px]">
                Access
              </TableHead>
              {MATRIX_COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    ROLE_COLUMN_CLASS,
                    'h-auto bg-transparent py-3.5 text-[13px] leading-[22px] font-semibold whitespace-nowrap text-[#101928]',
                  )}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {SECTIONS.map((section) => (
              <Fragment key={section}>
                <TableRow className="border-none hover:bg-transparent">
                  <TableCell
                    colSpan={MATRIX_COLUMNS.length + 1}
                    className="bg-[#f9fafb] px-6 py-[7px] text-[11px] leading-4 font-bold tracking-[0.66px] text-[#98a2b3]"
                  >
                    {section}
                  </TableCell>
                </TableRow>
                {MATRIX_ROWS.filter((row) => row.section === section).map((row) => (
                  <TableRow key={row.label} className="border-none hover:bg-transparent">
                    <TableCell className="px-6 py-3 text-sm font-medium whitespace-nowrap text-[#344054]">
                      {row.label}
                    </TableCell>
                    {MATRIX_COLUMNS.map((column) => (
                      <TableCell key={column.key} className={cn(ROLE_COLUMN_CLASS, 'py-3')}>
                        {row.check(column.key) ? (
                          <span className="inline-flex size-5 items-center justify-center rounded-full bg-[#ecfdf3] text-[#027a48]">
                            <Check className="size-3" aria-hidden="true" />
                            <span className="sr-only">Allowed</span>
                          </span>
                        ) : (
                          <span className="text-sm text-[#cbd2dc]" aria-hidden="true">
                            —
                          </span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
