'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Award, Calendar, Check, Download, Loader2 } from 'lucide-react';
import CertificateModal from './CertificateModal';
import CertificateDocument from './certificate/CertificateDocument';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getCertificateDetails } from '@/app/actions/certificate';
import {
  exportCertificatesPdf,
  formatCertificateIssueDate,
  generateQrDataUrl,
} from '@/lib/certificate-export';
import { formatCertificateId } from '@/lib/certificate-id';
import { logger } from '@/lib/logger';

interface CertificateData {
  id: string;
  enrollmentId: string;
  course: {
    title: string;
  };
  issuedAt: Date | string;
}

interface CertificateCardListProps {
  certificates: CertificateData[];
  title?: string;
  description?: string;
  showExport?: boolean;
}

/** Date windows offered by the header filter. */
type CertificateRange = '7' | '30' | 'all';

const RANGE_DAYS: Record<Exclude<CertificateRange, 'all'>, number> = { '7': 7, '30': 30 };

/** Everything one page of the exported PDF needs, resolved before any capture. */
interface CertificateExportPage {
  id: string;
  studentName: string;
  courseName: string;
  organizationName?: string;
  issueDate: string;
  certificateId: string;
  qrDataUrl?: string;
}

export default function CertificateCardList({
  certificates,
  title = 'Certificates',
  description = "Here's a brief overview of your certificates on the platform.",
  showExport = true,
}: CertificateCardListProps) {
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);
  // Defaults to 'all', NOT the design's "Last 7 days" chip: a certificate is a
  // long-lived record, so opening on a 7-day window would show the empty state
  // to a learner who simply earned theirs a month ago. `cutoff` is resolved when
  // the learner picks a range rather than during render — reading the clock in
  // render would make the visible set depend on when React re-renders, and
  // leaves the first server render and first client render free to disagree.
  const [filter, setFilter] = useState<{ range: CertificateRange; cutoff: number | null }>({
    range: 'all',
    cutoff: null,
  });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [exportPages, setExportPages] = useState<CertificateExportPage[] | null>(null);
  const exportNodesRef = useRef<(HTMLDivElement | null)[]>([]);

  const hasNone = certificates.length === 0;

  const selectRange = (range: CertificateRange) => {
    setFilter({
      range,
      cutoff: range === 'all' ? null : Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000,
    });
  };

  const visible = useMemo(() => {
    const { cutoff } = filter;
    if (cutoff === null) return certificates;
    return certificates.filter((c) => new Date(c.issuedAt).getTime() >= cutoff);
  }, [certificates, filter]);

  // Pin a fixed timeZone so the server (UTC) and browser (local) render the
  // same string — otherwise React reports a hydration mismatch (#418).
  const formatIssueDate = (dateString: Date | string) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };

  const formatIssueTime = (dateString: Date | string) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    });
  };

  // The export renders the real `CertificateDocument` for every certificate and
  // rasterises each into one page of a single PDF, so the download is the same
  // artwork the learner sees in the preview modal — not a summary of it.
  const handleExportAll = async () => {
    if (exporting || visible.length === 0) return;

    setExporting(true);
    setExportError(null);

    // Snapshot the filtered list: the range filter stays live during the
    // export, and both the pages and the progress count must describe the set
    // the learner actually asked for.
    const selected = visible;
    setProgress({ done: 0, total: selected.length });

    const pages: CertificateExportPage[] = [];
    for (const cert of selected) {
      try {
        const details = await getCertificateDetails(cert.id);

        let qrDataUrl: string | undefined;
        try {
          qrDataUrl = await generateQrDataUrl(
            `${window.location.origin}/verify-certificate/${cert.id}`,
          );
        } catch {
          /* QR is decorative — a page without it is still a valid certificate */
        }

        pages.push({
          id: cert.id,
          studentName:
            details.organizationUser?.user?.fullName ||
            details.organizationUser?.user?.email ||
            'Student Name',
          courseName: details.course?.title || cert.course.title,
          organizationName: details.organizationUser?.organization?.name,
          issueDate: formatCertificateIssueDate(details.issuedAt),
          certificateId: formatCertificateId(details.enrollmentId),
          qrDataUrl,
        });
        setProgress({ done: pages.length, total: selected.length });
      } catch (err) {
        // Abort the whole export rather than quietly dropping a page: a
        // certificate PDF is a compliance record, and a file that silently
        // omits one is worse than no file at all.
        logger.error({
          msg: '[certificate] Bulk export aborted — certificate details failed to load',
          err,
          certificateId: cert.id,
        });
        setExportError(
          `Could not load the certificate for “${cert.course.title}”, so nothing was downloaded. Please try again.`,
        );
        setExporting(false);
        return;
      }
    }

    exportNodesRef.current = [];
    setExportPages(pages);
  };

  // Capture runs only once React has committed the off-screen certificates, so
  // it is driven by the render rather than by the click handler.
  useEffect(() => {
    if (!exportPages) return;

    let cancelled = false;

    const capture = async () => {
      try {
        const nodes = exportNodesRef.current.filter(
          (node): node is HTMLDivElement => node !== null,
        );
        if (nodes.length !== exportPages.length) {
          throw new Error(
            `Rendered ${nodes.length} of ${exportPages.length} certificates for export`,
          );
        }

        await exportCertificatesPdf(nodes, 'certificates');
        logger.info({
          msg: '[certificate] Bulk certificate export completed',
          count: nodes.length,
        });
      } catch (err) {
        logger.error({ msg: '[certificate] Bulk certificate export failed', err });
        if (!cancelled) {
          setExportError('Could not build the certificate PDF. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setExportPages(null);
          setExporting(false);
        }
      }
    };

    void capture();

    return () => {
      cancelled = true;
    };
  }, [exportPages]);

  const exportLabel = !exporting
    ? 'Export'
    : exportPages
      ? 'Building PDF…'
      : `Exporting ${progress.done} of ${progress.total}…`;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:gap-0">
        <div>
          <h1 className="m-0 mb-1 text-2xl font-semibold tracking-[-0.5px] text-foreground md:text-[31.5px] md:leading-[40px]">
            {title}
          </h1>
          <p className="m-0 text-sm text-[#525252] md:text-lg">{description}</p>
        </div>
        {/* Present in every state, as the design draws them, but inert until there
            is something to filter or export — the design greys its own Export
            button in the empty state. `disabled` carries the Button variant's
            token-based grey, so this stays a design-system state rather than a
            hardcoded one. */}
        {showExport && (
          <div className="flex items-center gap-2.5">
            <Select
              value={filter.range}
              onValueChange={(value) => selectRange(value as CertificateRange)}
              disabled={hasNone}
            >
              <SelectTrigger
                aria-label="Filter certificates by date range"
                className="h-[41px] w-[159px] justify-start gap-2 rounded-[8px] border-[#d6d6d6] bg-white px-3 text-base font-medium text-[#514346] shadow-none [&>svg:last-child]:ml-auto [&>svg:last-child]:size-[18px]"
              >
                <Calendar className="size-[18px] text-[#514346]" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="h-[41px] gap-2 rounded-[12px] text-[15.5px] font-semibold has-[>svg]:px-6"
              onClick={handleExportAll}
              disabled={visible.length === 0 || exporting}
            >
              {exporting ? (
                <Loader2 className="size-[18px] animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-[18px]" aria-hidden="true" />
              )}
              {exportLabel}
            </Button>
          </div>
        )}
      </div>

      {exportError && (
        <Alert variant="error" title="Export failed" className="mb-6">
          {exportError}
        </Alert>
      )}

      {hasNone ? (
        // Design 15560:138390 seats the empty state in a white `Widget` card
        // (r17, centred) rather than letting it float on the page background.
        <div className="flex flex-col items-center justify-center gap-5 rounded-[17px] bg-white px-6 py-12 md:py-16">
          <Image
            src="/images/certificates-empty-state.svg"
            alt=""
            width={154}
            height={154}
            aria-hidden="true"
            className="size-[120px] md:size-[154px]"
          />
          <div className="flex max-w-[482px] flex-col gap-1.5 text-center">
            <p className="text-[22px] font-semibold leading-[1.32] text-[#11181c] md:text-[25px]">
              No certificate earned yet
            </p>
            <p className="text-[15px] leading-[1.5] text-[#475367] md:text-[16px]">
              Complete a course to earn your certificate — once you do, it will appear here.
            </p>
          </div>
          <Button asChild className="h-[47px] rounded-[12px] px-6 text-[16px] font-semibold">
            <Link href="/worker/trainings">Browse trainings</Link>
          </Button>
        </div>
      ) : visible.length === 0 ? (
        // A filtered-to-nothing list is NOT "no certificate earned yet" — saying
        // so would tell a learner who holds certificates that they hold none.
        <div className="flex flex-col items-center justify-center gap-5 rounded-[17px] bg-white px-6 py-12 md:py-16">
          <Image
            src="/images/certificates-empty-state.svg"
            alt=""
            width={154}
            height={154}
            aria-hidden="true"
            className="size-[120px] md:size-[154px]"
          />
          <div className="flex max-w-[482px] flex-col gap-1.5 text-center">
            <p className="text-[22px] font-semibold leading-[1.32] text-[#11181c] md:text-[25px]">
              Nothing in this date range
            </p>
            <p className="text-[15px] leading-[1.5] text-[#475367] md:text-[16px]">
              None of your {certificates.length} certificates were issued in the selected period.
              Widen the range to see them.
            </p>
          </div>
          <Button
            variant="outline"
            className="h-[47px] rounded-[12px] px-6 text-[16px] font-semibold"
            onClick={() => selectRange('all')}
          >
            Show all time
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((cert) => (
            <div
              key={cert.id}
              role="button"
              tabIndex={0}
              aria-label={`View certificate for ${cert.course.title}`}
              className="flex cursor-pointer flex-col items-start justify-between gap-4 rounded-xl border border-border bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:border-border hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:flex-row sm:items-center sm:gap-0 sm:px-6 sm:py-5"
              onClick={() => setSelectedCertId(cert.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedCertId(cert.id);
                }
              }}
            >
              <div className="flex items-center gap-5">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
                  <Award className="size-6" />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="m-0 text-base font-semibold text-foreground">
                    {cert.course.title}
                  </h3>
                  <span className="text-sm text-text-secondary">
                    Certificate ID: {formatCertificateId(cert.enrollmentId)}
                  </span>
                </div>
              </div>
              <div className="flex w-full items-center justify-between gap-8 border-t border-border pt-4 sm:w-auto sm:border-t-0 sm:pt-0">
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <span className="text-sm font-medium text-foreground">
                    {formatIssueDate(cert.issuedAt)}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {formatIssueTime(cert.issuedAt)}
                  </span>
                </div>
                <Badge
                  variant="secondary"
                  className="gap-1.5 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  <Check className="size-3" strokeWidth={3} />
                  Issued
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pushed off-screen rather than hidden: `display:none` / `visibility:hidden`
          collapse the node, and html-to-image would capture nothing. */}
      {exportPages && (
        <div aria-hidden="true" className="pointer-events-none fixed top-0 -left-[10000px]">
          {exportPages.map((page, index) => (
            <CertificateDocument
              key={page.id}
              ref={(node) => {
                exportNodesRef.current[index] = node;
              }}
              studentName={page.studentName}
              courseName={page.courseName}
              organizationName={page.organizationName}
              issueDate={page.issueDate}
              certificateId={page.certificateId}
              qrDataUrl={page.qrDataUrl}
            />
          ))}
        </div>
      )}

      {selectedCertId && (
        <CertificateModal
          isOpen={true}
          onClose={() => setSelectedCertId(null)}
          certificateId={selectedCertId}
        />
      )}
    </div>
  );
}
