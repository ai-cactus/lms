'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Build a compact pagination range with ellipses, e.g. [1, 2, 3, '…', 9].
 * Always shows the first and last page plus a window around the current page.
 */
export function buildPaginationRange(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');

  pages.push(total);
  return pages;
}

interface CoursesTableFooterProps {
  totalEntries: number;
  currentPage: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (itemsPerPage: number) => void;
}

export default function CoursesTableFooter({
  totalEntries,
  currentPage,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
}: CoursesTableFooterProps) {
  const totalPages = Math.ceil(totalEntries / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
      <span className="text-xs font-medium tracking-[-0.36px] text-[#9a9a9a]">
        Showing {totalEntries === 0 ? 0 : startIndex + 1} to{' '}
        {Math.min(startIndex + itemsPerPage, totalEntries)} of {totalEntries} entries
      </span>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
          disabled={currentPage === 1}
          onClick={() => handlePageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>

        {buildPaginationRange(currentPage, totalPages).map((page, i) =>
          page === 'ellipsis' ? (
            <span
              key={`ellipsis-${i}`}
              className="flex size-10 items-center justify-center text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <Button
              key={page}
              variant={page === currentPage ? 'default' : 'ghost'}
              size="icon-sm"
              className="size-10 rounded-[8px] text-xs font-medium tracking-[-0.36px] data-[variant=ghost]:text-[#1c1c1c]"
              onClick={() => handlePageChange(page)}
              aria-current={page === currentPage ? 'page' : undefined}
            >
              {page}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          size="icon-sm"
          className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
          disabled={currentPage === totalPages || totalPages === 0}
          onClick={() => handlePageChange(currentPage + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="flex items-center gap-3 text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]">
        Show
        <Select
          value={itemsPerPage.toString()}
          onValueChange={(v) => onItemsPerPageChange(Number(v))}
        >
          <SelectTrigger className="w-[66px] rounded-[8px] border-[#d9d9d9] px-3 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="5">5</SelectItem>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="20">20</SelectItem>
          </SelectContent>
        </Select>
        entries
      </div>
    </div>
  );
}
