'use client';

import { useState, useTransition, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { deleteDocument } from '@/app/actions/documents';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RowActionsMenu, type RowAction } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
  FileText,
  ShieldAlert,
  X,
} from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';
import { DOCUMENT_STATUS_LABELS, type DocumentLifecycleStatus } from '@/lib/documents/status';
import { useUploadProgress } from './upload-progress-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CourseVersionEntry {
  courseId: string;
  course: {
    title: string;
    status: string; // 'draft' | 'published'
  };
}

interface DocumentVersionEntry {
  id: string;
  version: number;
  courseVersions: CourseVersionEntry[];
  phiReport?: { hasPHI: boolean } | null;
}

interface DocumentUploader {
  email: string;
  profile: { firstName: string | null; lastName: string | null } | null;
}

interface DocumentRow {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Null for documents uploaded before categories existed. */
  category?: string | null;
  updatedAt: Date | string;
  user?: DocumentUploader | null;
  versions: DocumentVersionEntry[];
}

interface DocumentListClientProps {
  initialDocs: DocumentRow[];
  canUpload: boolean;
  canDelete: boolean;
  /** The organization's category vocabulary; defaults to none for standalone use. */
  categories?: string[];
}

const ALL_CATEGORIES = 'All';
type CategoryFilter = string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A document backing a generated course is still deletable by roles holding
 * document.delete — deletion severs the course's source-document link, so the
 * dialogs warn instead of blocking.
 */
function documentHasCourse(doc: DocumentRow) {
  return (doc.versions[0]?.courseVersions.length ?? 0) > 0;
}

function getFileIcon(mimeType: string, filename: string) {
  const isPdf = mimeType === 'application/pdf' || filename.endsWith('.pdf');
  const isDoc =
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    filename.endsWith('.docx') ||
    filename.endsWith('.doc');

  // Solid file glyph: `fill` paints the sheet, `text-white` the rules inside it.
  return (
    <FileText
      aria-hidden="true"
      className={cn(
        'size-[29px] shrink-0 text-white',
        isPdf ? 'fill-[#f04438]' : isDoc ? 'fill-[#444ce7]' : 'fill-[#94a3b8]',
      )}
    />
  );
}

const tableHeadClass =
  'h-[41px] truncate text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] sm:text-[15.5px]';

const statusPillClass =
  'inline-flex h-[33px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap sm:px-3 sm:text-[13px]';

function StatusBadge({ status }: { status: DocumentLifecycleStatus }) {
  if (status === 'completed') {
    return (
      <span className={cn(statusPillClass, 'bg-[#eafdf5] text-[#308242]')}>
        <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 fill-[#13a000] text-white" />
        {DOCUMENT_STATUS_LABELS.completed}
      </span>
    );
  }
  return (
    <span className={cn(statusPillClass, 'bg-[#fffad1] text-[#d8651e]')}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {DOCUMENT_STATUS_LABELS.in_progress}
    </span>
  );
}

/**
 * Pull the file down through the same-origin preview proxy rather than a raw
 * signed storage URL: the browser only honours `download` on same-origin hrefs,
 * and the proxy is where PHI document access gets audited.
 */
function downloadDocumentVersion(versionId: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = `/api/documents/${versionId}/preview`;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DocumentListClient({
  initialDocs,
  canUpload,
  canDelete,
  categories = [],
}: DocumentListClientProps) {
  const router = useRouter();
  const { pendingUploads } = useUploadProgress();
  const [docs, setDocs] = useState(initialDocs);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    hasCourse: boolean;
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(ALL_CATEGORIES);

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Sync with server props after revalidatePath
  useEffect(() => {
    setDocs(initialDocs);
  }, [initialDocs]);

  // Only offer categories that actually classify a document, so the filter
  // never advertises an empty option.
  const availableCategories = useMemo(
    () => categories.filter((category) => docs.some((d) => d.category === category)),
    [categories, docs],
  );

  // A category can disappear once its last document is deleted; fall back to
  // "All" rather than stranding the list on an empty filter.
  const activeCategory: CategoryFilter =
    categoryFilter === ALL_CATEGORIES || availableCategories.includes(categoryFilter)
      ? categoryFilter
      : ALL_CATEGORIES;

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return docs.filter(
      (d) =>
        (activeCategory === ALL_CATEGORIES || d.category === activeCategory) &&
        (!q || d.filename.toLowerCase().includes(q)),
    );
  }, [docs, searchQuery, activeCategory]);

  const totalPages = Math.ceil(filteredDocs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const pagedDocs = filteredDocs.slice(startIndex, startIndex + itemsPerPage);
  const totalEntries = filteredDocs.length;

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) {
        setCurrentPage(page);
        clearSelection();
      }
    },
    [totalPages, clearSelection],
  );

  // Selection is keyed by id, so rows removed by a delete or a server refresh
  // drop out of every count on their own.
  const selectedDocs = useMemo(
    () => docs.filter((d) => selectedIds.has(d.id)),
    [docs, selectedIds],
  );
  const deletableSelectedIds = useMemo(() => selectedDocs.map((d) => d.id), [selectedDocs]);
  const courseBackedSelectedCount = useMemo(
    () => selectedDocs.filter(documentHasCourse).length,
    [selectedDocs],
  );

  const selectedOnPageCount = pagedDocs.filter((d) => selectedIds.has(d.id)).length;
  const headerCheckboxState: boolean | 'indeterminate' =
    pagedDocs.length > 0 && selectedOnPageCount === pagedDocs.length
      ? true
      : selectedOnPageCount > 0
        ? 'indeterminate'
        : false;

  const toggleSelected = (docId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const toggleSelectPage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const doc of pagedDocs) {
        if (checked) next.add(doc.id);
        else next.delete(doc.id);
      }
      return next;
    });
  };

  const handleRowClick = (docId: string) => {
    router.push(`/dashboard/documents/${docId}`);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const docId = deleteTarget.id;
    setDeleteTarget(null);
    setDeletingId(docId);
    setDeleteError(null);

    startTransition(async () => {
      const result = await deleteDocument(docId);
      if (result.success) {
        setDocs((prev) => prev.filter((d) => d.id !== docId));
      } else {
        setDeleteError(result.error ?? 'Failed to delete document.');
      }
      setDeletingId(null);
    });
  };

  const handleConfirmBulkDelete = () => {
    const ids = deletableSelectedIds;
    setBulkDeleteOpen(false);
    if (ids.length === 0) return;
    setDeleteError(null);
    setIsBulkDeleting(true);

    startTransition(async () => {
      // Sequential: each delete also removes storage objects, so this trades a
      // little latency for not fanning out storage calls from one click.
      const deletedIds = new Set<string>();
      let firstError: string | null = null;
      for (const id of ids) {
        const result = await deleteDocument(id);
        if (result.success) deletedIds.add(id);
        else if (!firstError) firstError = result.error ?? 'Failed to delete document.';
      }

      setDocs((prev) => prev.filter((d) => !deletedIds.has(d.id)));
      clearSelection();
      if (firstError) {
        setDeleteError(
          `${ids.length - deletedIds.size} of ${ids.length} documents could not be deleted. ${firstError}`,
        );
      }
      setIsBulkDeleting(false);
    });
  };

  // Pagination page numbers to render (show max 5 page numbers with ellipsis)
  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (currentPage <= 3) return [1, 2, 3, '…', totalPages];
    if (currentPage >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages];
    return [1, '…', currentPage, '…', totalPages];
  }, [totalPages, currentPage]);

  return (
    <>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &ldquo;{deleteTarget?.name}&rdquo; and all its versions
              from storage. This action cannot be undone.
              {deleteTarget?.hasCourse &&
                ' This document is the source for a generated course — the course will remain, but its source-document link will be removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deletableSelectedIds.length}{' '}
              {deletableSelectedIds.length === 1 ? 'document' : 'documents'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{' '}
              {deletableSelectedIds.length === 1 ? 'this document' : 'these documents'} and all
              their versions from storage. This action cannot be undone.
              {courseBackedSelectedCount > 0 &&
                ` ${courseBackedSelectedCount} selected ${
                  courseBackedSelectedCount === 1 ? 'document backs' : 'documents back'
                } a generated course — the courses will remain, but their source-document links will be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleConfirmBulkDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {deleteError && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
          ⚠️ {deleteError}
        </p>
      )}

      <div className="flex min-w-0 flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:px-[21px] md:pt-[21px] md:pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full lg:max-w-[470px]">
            <Input
              className="h-[38px] rounded-[8px] border-[#dfe1e6] pl-9 text-[15px] placeholder:text-[#a4abb8]"
              type="search"
              placeholder="Search for document..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
                clearSelection();
              }}
              aria-label="Search documents"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>

          <Select
            value={activeCategory}
            onValueChange={(value) => {
              setCategoryFilter(value as CategoryFilter);
              setCurrentPage(1);
              clearSelection();
            }}
          >
            <SelectTrigger
              aria-label="Filter by category"
              className="h-[38px] w-full rounded-[8px] border-[#dfe1e6] px-4 text-[15px] text-[#0d0d12] *:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate lg:w-[200px] lg:shrink-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>All Documents</SelectItem>
              {availableCategories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canDelete && selectedDocs.length > 0 && (
          <div
            role="region"
            aria-label="Bulk actions"
            className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#dfe1e6] bg-background-secondary px-4 py-3"
          >
            <span className="text-sm font-semibold text-foreground">
              {selectedDocs.length} selected
            </span>
            {courseBackedSelectedCount > 0 && (
              <span className="text-sm text-text-secondary">
                {courseBackedSelectedCount}{' '}
                {courseBackedSelectedCount === 1 ? 'document backs' : 'documents back'} a generated
                course — deleting removes the source link
              </span>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="ml-auto"
              loading={isBulkDeleting}
              disabled={deletableSelectedIds.length === 0}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete
            </Button>
          </div>
        )}

        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              {canDelete && (
                <TableHead
                  className={cn(
                    tableHeadClass,
                    'w-[36px] rounded-l-[9px] px-1 sm:w-[52px] sm:px-4',
                  )}
                >
                  <Checkbox
                    checked={headerCheckboxState}
                    onCheckedChange={(checked) => toggleSelectPage(checked === true)}
                    disabled={pagedDocs.length === 0}
                    aria-label="Select all documents on this page"
                  />
                </TableHead>
              )}
              <TableHead
                className={cn(tableHeadClass, 'px-1 sm:px-[18px]', !canDelete && 'rounded-l-[9px]')}
              >
                Document Name
              </TableHead>
              <TableHead
                className={cn(
                  tableHeadClass,
                  'hidden px-5 sm:table-cell sm:w-[130px] lg:w-[170px]',
                )}
              >
                Category
              </TableHead>
              <TableHead className={cn(tableHeadClass, 'hidden px-5 lg:table-cell lg:w-[130px]')}>
                Facility
              </TableHead>
              <TableHead
                className={cn(tableHeadClass, 'w-[104px] px-1 sm:w-[160px] sm:px-5 lg:w-[180px]')}
              >
                Status
              </TableHead>
              <TableHead
                className={cn(
                  tableHeadClass,
                  'w-[44px] rounded-r-[9px] px-0 text-right sm:w-[70px] sm:pr-[19px] lg:w-[80px]',
                )}
              >
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Files still uploading have no server row yet — surface them so the
                list never looks idle while a batch is in flight. */}
            {pendingUploads.map((upload) => (
              <TableRow key={`pending-${upload.id}`} className="h-[71px]">
                {canDelete && <TableCell className="px-1 py-0 sm:px-4" />}

                <TableCell className="px-1 py-0 sm:px-[18px]">
                  <div className="flex items-center gap-3 sm:gap-[18px]">
                    {getFileIcon('', upload.name)}
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-[14px] font-semibold tracking-[0.31px] text-[#0d0d12] sm:text-[15.5px]">
                        {upload.name}
                      </span>
                      <span className="truncate text-[12px] font-normal tracking-[0.27px] text-[#666d80] sm:text-[13.5px]">
                        {formatFileSize(upload.size)}
                      </span>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="hidden truncate px-5 py-0 text-[15px] font-medium whitespace-nowrap text-[#0d0d12] sm:table-cell lg:text-[17px]">
                  {upload.category || '—'}
                </TableCell>

                <TableCell className="hidden px-5 py-0 lg:table-cell">
                  <Badge className="bg-primary/10 px-2.5 py-1 text-[13px] font-semibold text-primary">
                    Global
                  </Badge>
                </TableCell>

                <TableCell className="px-1 py-0 sm:px-5">
                  <StatusBadge status="in_progress" />
                </TableCell>

                <TableCell className="px-0 py-0 sm:pr-[19px]" />
              </TableRow>
            ))}

            {pagedDocs.length > 0 ? (
              pagedDocs.map((doc) => {
                const latest = doc.versions[0];
                const hasCourse = (latest?.courseVersions.length ?? 0) > 0;
                const hasPHI = latest?.phiReport?.hasPHI ?? false;
                const isDeleting = deletingId === doc.id;

                const rowActions: RowAction[] = [];
                if (latest) {
                  rowActions.push({
                    label: 'Download',
                    icon: <Download className="size-4" />,
                    onSelect: () => downloadDocumentVersion(latest.id, doc.filename),
                  });
                }
                if (canDelete) {
                  rowActions.push({
                    label: isDeleting ? 'Deleting…' : 'Delete',
                    icon: <X className="size-4" />,
                    variant: 'destructive',
                    separatorBefore: rowActions.length > 0,
                    disabled: isDeleting,
                    onSelect: () => setDeleteTarget({ id: doc.id, name: doc.filename, hasCourse }),
                  });
                }

                return (
                  <TableRow
                    key={doc.id}
                    onClick={() => handleRowClick(doc.id)}
                    className="h-[71px] cursor-pointer"
                  >
                    {canDelete && (
                      <TableCell className="px-1 py-0 sm:px-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(doc.id)}
                          onCheckedChange={() => toggleSelected(doc.id)}
                          aria-label={`Select ${doc.filename}`}
                        />
                      </TableCell>
                    )}

                    <TableCell className="px-1 py-0 sm:px-[18px]">
                      <div className="flex items-center gap-3 sm:gap-[18px]">
                        {getFileIcon(doc.mimeType, doc.filename)}
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate text-[14px] font-semibold tracking-[0.31px] text-[#0d0d12] sm:text-[15.5px]">
                            {doc.filename}
                          </span>
                          <span className="truncate text-[12px] font-normal tracking-[0.27px] text-[#666d80] sm:text-[13.5px]">
                            {formatFileSize(doc.size)}
                            {latest?.version && ` • v${latest.version}`}
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="hidden truncate px-5 py-0 text-[15px] font-medium whitespace-nowrap text-[#0d0d12] sm:table-cell lg:text-[17px]">
                      {doc.category || '—'}
                    </TableCell>

                    <TableCell className="hidden px-5 py-0 lg:table-cell">
                      <Badge className="bg-primary/10 px-2.5 py-1 text-[13px] font-semibold text-primary">
                        Global
                      </Badge>
                    </TableCell>

                    <TableCell className="px-1 py-0 sm:px-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status="completed" />
                        {hasPHI && (
                          <span
                            className="inline-flex h-[33px] items-center gap-1.5 rounded-full bg-[#fbe7e7] px-[13px] text-[14px] font-semibold whitespace-nowrap text-[#e13737]"
                            title="This document was flagged as containing PHI"
                          >
                            <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
                            PHI Flagged
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell
                      className="px-0 py-0 sm:pr-[19px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1 sm:gap-3">
                        {rowActions.length > 0 && (
                          <RowActionsMenu
                            className="size-8 rounded-[8px] border border-[#ece4e4] bg-white text-[#0d0d12] [&_svg]:size-4"
                            actions={rowActions}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : pendingUploads.length > 0 ? null : (
              <EmptyTableState
                message={searchQuery ? 'No documents match your search.' : 'No documents found.'}
                subMessage={
                  searchQuery
                    ? 'Try a different search term.'
                    : canUpload
                      ? 'Upload a document to get started.'
                      : 'No documents have been uploaded yet.'
                }
                colSpan={canDelete ? 6 : 5}
                asTableRow
              />
            )}
          </TableBody>
        </Table>

        {totalEntries > 0 && (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
            <span className="text-xs font-medium tracking-[-0.36px] text-[#9a9a9a]">
              Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalEntries)} of{' '}
              {totalEntries} entries
            </span>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
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
                    variant={n === currentPage ? 'default' : 'ghost'}
                    size="icon-sm"
                    className="size-10 rounded-[8px] text-xs font-medium tracking-[-0.36px] data-[variant=ghost]:text-[#1c1c1c]"
                    onClick={() => handlePageChange(n as number)}
                    aria-current={n === currentPage ? 'page' : undefined}
                  >
                    {n}
                  </Button>
                ),
              )}

              <Button
                variant="outline"
                size="icon-sm"
                className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || totalPages === 0}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex items-center gap-3 text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]">
              Show
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(v) => {
                  setItemsPerPage(Number(v));
                  setCurrentPage(1);
                  clearSelection();
                }}
              >
                <SelectTrigger className="w-[66px] rounded-[8px] border-[#d9d9d9] px-3 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
              entries
            </div>
          </div>
        )}
      </div>
    </>
  );
}
