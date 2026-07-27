'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getCertificateDetails } from '@/app/actions/certificate';
import CertificateDocument, { CERT_HEIGHT, CERT_WIDTH } from './certificate/CertificateDocument';
import { exportCertificatePdf, generateQrDataUrl } from '@/lib/certificate-export';
import { formatCertificateId } from '@/lib/certificate-id';

type CertificateData = Awaited<ReturnType<typeof getCertificateDetails>>;

interface CertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificateId: string;
}

function formatIssueDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function CertificateModal({
  isOpen,
  onClose,
  certificateId,
}: CertificateModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CertificateData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | undefined>();
  const [exporting, setExporting] = useState(false);

  const docRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    if (!isOpen || !certificateId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getCertificateDetails(certificateId)
      .then(async (res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
        try {
          const verifyValue = `${window.location.origin}/verify-certificate/${certificateId}`;
          const qr = await generateQrDataUrl(verifyValue);
          if (!cancelled) setQrDataUrl(qr);
        } catch {
          /* QR is decorative — ignore generation failures */
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, certificateId]);

  // The certificate is authored at a fixed A4-landscape size, so it is scaled to
  // whatever width the card gets. The card is measured rather than the certificate's
  // own wrapper — a percentage-width wrapper would be inflated to the certificate's
  // intrinsic 1123px by the dialog's min-content sizing.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / CERT_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const handleExport = async () => {
    if (!docRef.current || !data) return;
    setExporting(true);
    try {
      const name = data.user?.profile?.fullName || data.user?.email || 'certificate';
      await exportCertificatePdf(docRef.current, `Certificate-${data.course?.title}-${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export certificate');
    } finally {
      setExporting(false);
    }
  };

  // The dialog content spans the viewport so the close button can sit in the page's
  // top-right corner, which means Radix no longer sees clicks beside the certificate
  // as "outside" — dismiss them here instead.
  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onClick={handleBackdropClick}
        className="top-0 left-0 flex h-full max-w-none translate-x-0 translate-y-0 items-center justify-center overflow-y-auto rounded-none border-0 bg-transparent px-4 py-20 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">Certificate of completion</DialogTitle>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-3 p-4 sm:p-[30px]">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!data || exporting}
            className="pointer-events-auto h-10 rounded-full bg-white px-5 shadow-sm"
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            {exporting ? 'Exporting…' : 'Export PDF'}
          </Button>
          <DialogClose className="pointer-events-auto flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white text-foreground shadow-sm transition-colors hover:bg-background-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <X className="size-5" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        {loading ? (
          <div className="rounded-[14px] bg-white p-12 text-center text-text-secondary shadow-lg">
            Loading certificate...
          </div>
        ) : error ? (
          <div className="rounded-[14px] bg-white p-12 text-center text-error shadow-lg">
            {error}
          </div>
        ) : data ? (
          <div
            ref={cardRef}
            className="w-full max-w-[1000px] overflow-hidden rounded-[14px] shadow-2xl"
            style={{ height: CERT_HEIGHT * scale }}
          >
            <div
              className="origin-top-left"
              style={{ width: CERT_WIDTH, transform: `scale(${scale})` }}
            >
              <CertificateDocument
                ref={docRef}
                studentName={data.user?.profile?.fullName || data.user?.email || 'Student Name'}
                courseName={data.course?.title || 'Course Title'}
                organizationName={data.user?.organization?.name}
                issueDate={formatIssueDate(data.issuedAt)}
                certificateId={formatCertificateId(data.enrollmentId)}
                qrDataUrl={qrDataUrl}
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
