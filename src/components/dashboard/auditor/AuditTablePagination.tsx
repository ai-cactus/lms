'use client';

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const AUDIT_PAGE_SIZES = [10, 25, 50] as const;
export const AUDIT_DEFAULT_PAGE_SIZE = 10;

interface AuditTablePaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  totalEntries: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Distinguishes the two tables' page-size selects for assistive tech. */
  label: string;
}

export default function AuditTablePagination({
  page,
  pageSize,
  totalEntries,
  onPageChange,
  onPageSizeChange,
  label,
}: AuditTablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const startIndex = (page - 1) * pageSize;

  const pageNumbers = useMemo<(number | '…')[]>(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, '…', totalPages];
    if (page >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages];
    return [1, '…', page, '…', totalPages];
  }, [totalPages, page]);

  const goTo = (next: number) => {
    if (next >= 1 && next <= totalPages && next !== page) onPageChange(next);
  };

  return (
    <div className="flex flex-col items-center gap-4 border-t border-[#f1f5f9] px-4 py-4 sm:flex-row sm:flex-wrap sm:justify-between sm:px-6">
      <span className="text-[13px] text-[#64748b]">
        Showing {totalEntries === 0 ? 0 : startIndex + 1} to{' '}
        {Math.min(startIndex + pageSize, totalEntries)} of {totalEntries} entries
      </span>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          className="size-9 rounded-[8px] border-[#e2e8f0] bg-white text-[#0f172a]"
          disabled={page === 1}
          onClick={() => goTo(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>

        {pageNumbers.map((entry, i) =>
          entry === '…' ? (
            <span
              key={`ellipsis-${i}`}
              className="flex size-9 items-center justify-center text-[13px] text-[#64748b]"
            >
              …
            </span>
          ) : (
            <Button
              key={entry}
              variant={entry === page ? 'default' : 'ghost'}
              size="icon-sm"
              className="size-9 rounded-[8px] text-[13px] font-medium data-[variant=ghost]:text-[#0f172a]"
              onClick={() => goTo(entry)}
              aria-label={`Page ${entry}`}
              aria-current={entry === page ? 'page' : undefined}
            >
              {entry}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          size="icon-sm"
          className="size-9 rounded-[8px] border-[#e2e8f0] bg-white text-[#0f172a]"
          disabled={page === totalPages}
          onClick={() => goTo(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2.5 text-[13px] text-[#64748b]">
        Show
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger
            className="h-9 w-[68px] rounded-[8px] border-[#e2e8f0] px-3 text-[13px] text-[#0f172a]"
            aria-label={label}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUDIT_PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        entries
      </div>
    </div>
  );
}
