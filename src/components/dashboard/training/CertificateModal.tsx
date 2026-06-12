'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getCertificateDetails } from '@/app/actions/certificate';
import CertificateDocument, { CERT_HEIGHT, CERT_WIDTH } from './certificate/CertificateDocument';
import { exportCertificatePdf, generateQrDataUrl } from '@/lib/certificate-export';

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

function readableCertId(data: CertificateData): string {
  return `CERT-${data.enrollmentId.substring(0, 8).toUpperCase()}`;
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.82);

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
          const verifyValue = `${window.location.origin}/api/certificates/${certificateId}`;
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

  // Scale the fixed-size certificate down to fit the dialog width.
  useLayoutEffect(() => {
    const el = wrapRef.current;
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

  if (!isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[1040px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-6 py-5">
          <DialogTitle className="text-xl font-semibold text-foreground">
            Certificate Details
          </DialogTitle>
          <div className="mr-8 flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!data || exporting}
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              {exporting ? 'Exporting…' : 'Export PDF'}
            </Button>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="p-12 text-center text-text-secondary">Loading certificate...</div>
        ) : error ? (
          <div className="p-12 text-center text-error">{error}</div>
        ) : data ? (
          <div className="bg-background-secondary p-4 sm:p-8">
            <div ref={wrapRef} style={{ width: '100%', height: CERT_HEIGHT * scale }}>
              <div style={{ transformOrigin: 'top left', transform: `scale(${scale})` }}>
                <CertificateDocument
                  ref={docRef}
                  studentName={data.user?.profile?.fullName || data.user?.email || 'Student Name'}
                  courseName={data.course?.title || 'Course Title'}
                  organizationName={data.user?.organization?.name}
                  issueDate={formatIssueDate(data.issuedAt)}
                  certificateId={readableCertId(data)}
                  qrDataUrl={qrDataUrl}
                />
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
