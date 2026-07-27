'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { cn } from '@/lib/utils';

interface Invoice {
  id: string;
  invoiceNumber: string;
  amountPaid: number;
  currency: string;
  status: string;
  invoiceUrl: string | null;
  pdfUrl: string | null;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Dot + label colours for an invoice status, matching the design's status pills. */
function getStatusColorClass(status: string): { dot: string; label: string } {
  switch (status.toLowerCase()) {
    case 'paid':
      return { dot: 'bg-[#10b981]', label: 'text-[#059669]' };
    case 'open':
    case 'pending':
      return { dot: 'bg-[#f59e0b]', label: 'text-[#b45309]' };
    case 'failed':
    case 'uncollectible':
      return { dot: 'bg-[#ef4444]', label: 'text-[#b91c1c]' };
    default:
      return { dot: 'bg-[#94a3b8]', label: 'text-[#475569]' };
  }
}

function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const tableHeadClass =
  'h-auto bg-[#f8fafc] px-4 py-4 text-[14px] leading-[20px] font-semibold whitespace-nowrap text-[#334155] uppercase sm:px-6';
const tableCellClass =
  'px-4 py-6 text-[14px] leading-[20px] font-medium whitespace-nowrap text-[#0f172a] sm:px-6';
const invoiceLinkClass =
  'inline-flex items-center justify-end gap-1 text-[14px] leading-[20px] font-bold text-primary hover:underline';

export default function BillingHistoryTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInvoices = useCallback(async (p: number) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/billing/invoices?page=${p}`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to load invoices');
      }
      const json = await res.json();
      setInvoices(json.invoices);
      setPagination(json.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInvoices(page);
  }, [fetchInvoices, page]);

  const pageNumbers = useMemo<(number | '…')[]>(() => {
    const totalPages = pagination?.totalPages ?? 0;
    const current = pagination?.page ?? 1;
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (current <= 3) return [1, 2, 3, '…', totalPages];
    if (current >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages];
    return [1, '…', current, '…', totalPages];
  }, [pagination]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-sm text-text-tertiary">
        <Loader2 className="size-7 animate-spin text-primary" aria-hidden="true" />
        <span>Loading invoices...</span>
      </div>
    );
  }

  if (error)
    return (
      <div className="mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-[13px] text-error">
        {error}
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-hidden rounded-[12px] border border-[#e2e8f0] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
        <Table>
          <TableHeader>
            <TableRow className="border-0 border-b border-solid border-[#e2e8f0] hover:bg-transparent">
              <TableHead className={tableHeadClass}>Date</TableHead>
              <TableHead className={tableHeadClass}>Invoice ID</TableHead>
              <TableHead className={cn(tableHeadClass, 'hidden xl:table-cell')}>Period</TableHead>
              <TableHead className={tableHeadClass}>Amount</TableHead>
              <TableHead className={tableHeadClass}>Status</TableHead>
              <TableHead className={cn(tableHeadClass, 'text-right text-[#64748b]')}>
                Invoice
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <EmptyTableState message="No invoices found." colSpan={6} asTableRow />
            ) : (
              invoices.map((inv) => (
                <TableRow key={inv.id} className="border-0 border-t border-solid border-[#f1f5f9]">
                  <TableCell className={cn(tableCellClass, 'font-normal text-[#475569]')}>
                    {formatDate(inv.createdAt)}
                  </TableCell>
                  <TableCell className={tableCellClass}>{inv.invoiceNumber}</TableCell>
                  <TableCell
                    className={cn(
                      tableCellClass,
                      'hidden font-normal text-[#475569] xl:table-cell',
                    )}
                  >
                    {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                  </TableCell>
                  <TableCell className={tableCellClass}>
                    {formatAmount(inv.amountPaid, inv.currency)}
                  </TableCell>
                  <TableCell className={tableCellClass}>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-[6px] shrink-0 rounded-full',
                          getStatusColorClass(inv.status).dot,
                        )}
                      />
                      <span
                        className={cn(
                          'text-[12px] leading-[16px] font-bold tracking-[0.6px] uppercase',
                          getStatusColorClass(inv.status).label,
                        )}
                      >
                        {inv.status}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className={cn(tableCellClass, 'text-right')}>
                    {inv.pdfUrl ? (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={invoiceLinkClass}
                      >
                        <Download className="size-3" aria-hidden="true" />
                        Download
                      </a>
                    ) : inv.invoiceUrl ? (
                      <a
                        href={inv.invoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={invoiceLinkClass}
                      >
                        <ExternalLink className="size-3" aria-hidden="true" />
                        View
                      </a>
                    ) : (
                      <span className="text-[14px] text-[#94a3b8]">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
          <span className="text-xs font-medium tracking-[-0.36px] text-[#9a9a9a]">
            Showing {(pagination.page - 1) * pagination.pageSize + 1} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total} entries
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>

            {pageNumbers.map((n, i) =>
              n === '…' ? (
                <span
                  key={`ellipsis-${i}`}
                  className="flex size-10 items-center justify-center text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]"
                >
                  …
                </span>
              ) : (
                <Button
                  key={n}
                  variant={n === pagination.page ? 'default' : 'ghost'}
                  size="icon-sm"
                  className="size-10 rounded-[8px] text-xs font-medium tracking-[-0.36px] data-[variant=ghost]:text-[#1c1c1c]"
                  onClick={() => setPage(n as number)}
                  aria-current={n === pagination.page ? 'page' : undefined}
                >
                  {n}
                </Button>
              ),
            )}

            <Button
              variant="outline"
              size="icon-sm"
              className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
