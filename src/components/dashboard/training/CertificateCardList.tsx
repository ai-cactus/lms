'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Award, Calendar, Check, Download } from 'lucide-react';
import CertificateModal from './CertificateModal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCertificateId } from '@/lib/certificate-id';

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

  const handleExportAll = () => {
    // Basic CSV export for demonstration
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      'Certificate ID,Course,Issued Date\n' +
      visible
        .map(
          (c) =>
            `${formatCertificateId(c.enrollmentId)},"${c.course.title}",${new Date(c.issuedAt).toISOString()}`,
        )
        .join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'certificates_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
              disabled={visible.length === 0}
            >
              <Download className="size-[18px]" />
              Export
            </Button>
          </div>
        )}
      </div>

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
                  Approved
                </Badge>
              </div>
            </div>
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
