'use client';

import React, { useState } from 'react';
import { Award, Check, Download } from 'lucide-react';
import CertificateModal from './CertificateModal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface CertificateData {
  id: string;
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

export default function CertificateCardList({
  certificates,
  title = 'Certificates',
  description = "Here's a quick summary of your earned certificates.",
  showExport = true,
}: CertificateCardListProps) {
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);

  const formatIssueDate = (dateString: Date | string) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatIssueTime = (dateString: Date | string) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const handleExportAll = () => {
    // Basic CSV export for demonstration
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      'Certificate ID,Course,Issued Date\n' +
      certificates
        .map((c) => `${c.id},"${c.course.title}",${new Date(c.issuedAt).toISOString()}`)
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
          <h1 className="m-0 mb-1 text-2xl font-bold text-foreground">{title}</h1>
          <p className="m-0 text-sm text-text-secondary">{description}</p>
        </div>
        {showExport && (
          <div className="flex items-center gap-3">
            <div>
              <select className="cursor-pointer rounded-md border border-border bg-white px-3 py-2 text-sm text-text-secondary outline-none">
                <option>Last 7 days</option>
                <option>Last 30 days</option>
                <option>All time</option>
              </select>
            </div>
            <Button
              variant="outline"
              className="flex items-center gap-2 bg-white"
              onClick={handleExportAll}
            >
              <Download className="size-4" />
              Export
            </Button>
          </div>
        )}
      </div>

      {certificates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background-secondary p-12 text-center text-text-secondary">
          No certificates available.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {certificates.map((cert) => (
            <div
              key={cert.id}
              className="flex cursor-pointer flex-col items-start justify-between gap-4 rounded-xl border border-border bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:border-border hover:shadow-md sm:flex-row sm:items-center sm:gap-0 sm:px-6 sm:py-5"
              onClick={() => setSelectedCertId(cert.id)}
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
                    Certificate ID: #{cert.id.substring(0, 8).toUpperCase()}
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
