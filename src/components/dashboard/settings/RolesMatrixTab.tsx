'use client';

import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { MATRIX_COLUMNS, MATRIX_ROWS, type MatrixSection } from '@/lib/rbac/roles-matrix-config';

const SECTIONS: MatrixSection[] = ['NAVIGATION', 'ACTIONS & DATA'];

export default function RolesMatrixTab() {
  return (
    <div className="flex flex-col">
      <div className="mb-6 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">System roles — platform access</h2>
        <p className="text-sm text-text-secondary">
          Access is set by the role you assign. A check means that role can see the section or
          perform the action.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left font-semibold text-foreground">Access</th>
              {MATRIX_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className="px-4 py-3 text-center font-semibold text-foreground whitespace-nowrap"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => (
              <Fragment key={section}>
                <tr className="bg-background-secondary">
                  <td
                    colSpan={MATRIX_COLUMNS.length + 1}
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary"
                  >
                    {section}
                  </td>
                </tr>
                {MATRIX_ROWS.filter((row) => row.section === section).map((row) => (
                  <tr key={row.label} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{row.label}</td>
                    {MATRIX_COLUMNS.map((column) => (
                      <td key={column.key} className="px-4 py-3 text-center">
                        {row.check(column.key) ? (
                          <span className="inline-flex size-5 items-center justify-center rounded-full bg-success/15 text-success">
                            <Check className="size-3.5" aria-hidden="true" />
                            <span className="sr-only">Allowed</span>
                          </span>
                        ) : (
                          <span className="text-text-secondary/50" aria-hidden="true">
                            —
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
