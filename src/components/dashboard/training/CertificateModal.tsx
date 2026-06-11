'use client';

import React, { useEffect, useState } from 'react';
import { Award, QrCode } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getCertificateDetails } from '@/app/actions/certificate';

type CertificateData = Awaited<ReturnType<typeof getCertificateDetails>>;

interface CertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificateId: string;
}

export default function CertificateModal({
  isOpen,
  onClose,
  certificateId,
}: CertificateModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CertificateData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !certificateId) return;

    let cancelled = false;

    getCertificateDetails(certificateId)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
          setError(null);
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

  if (!isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-[1000px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-6 py-5">
          <DialogTitle className="text-xl font-semibold text-foreground">
            Certificate Details
          </DialogTitle>
          <div className="mr-8 flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`/api/certificates/${certificateId}`, '_blank')}
            >
              Export
            </Button>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="p-12 text-center text-text-secondary">Loading certificate...</div>
        ) : error ? (
          <div className="p-12 text-center text-error">{error}</div>
        ) : (
          <div className="flex items-center justify-center bg-background-secondary p-4 [container-type:inline-size] sm:p-10">
            <div className="relative flex aspect-[1.414/1] w-full max-w-[800px] flex-col justify-between overflow-hidden border border-border bg-white px-6 py-4 shadow-[0_4px_6px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.1)] sm:px-[60px] sm:py-10">
              {/* Watermark */}
              <div className="pointer-events-none absolute top-1/2 left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 -rotate-30 text-[clamp(40px,15cqw,120px)] font-extrabold tracking-[clamp(4px,1.25cqw,10px)] text-black/[0.03] uppercase">
                Theraptly
              </div>

              {/* Logo Top Right */}
              <div className="absolute top-4 right-6 z-[2] sm:top-10 sm:right-[60px]">
                <h1 className="text-[clamp(1rem,3cqw,1.5rem)] font-bold tracking-[1px] text-[#2d3748]">
                  Theraptly
                </h1>
              </div>

              {/* Top Banner/Border */}
              <div className="absolute top-0 right-0 left-0 h-[clamp(4px,1cqw,8px)] bg-gradient-to-r from-[#1a365d] to-[#2b6cb0]" />

              {/* Content */}
              <div className="relative z-[2] mt-6 flex flex-grow flex-col items-center justify-center text-center sm:mt-[60px]">
                <h2 className="m-0 mb-3 text-[clamp(1.25rem,5cqw,2.5rem)] font-extrabold tracking-[clamp(1px,0.25cqw,2px)] text-[#1a365d] sm:mb-6">
                  CERTIFICATE OF COMPLETION
                </h2>
                <p className="m-0 mb-3 text-[clamp(0.75rem,2cqw,1.1rem)] tracking-[1px] text-[#4a5568] uppercase sm:mb-6">
                  This is to certify that
                </p>
                <h3 className="m-0 mb-3 inline-block min-w-[60%] border-b-2 border-border pb-1 font-serif text-[clamp(1.5rem,6cqw,3rem)] font-bold text-[#2d3748] sm:mb-6 sm:pb-2">
                  {data?.user?.profile?.fullName || data?.user?.email || 'Student Name'}
                </h3>
                <p className="m-0 mb-2 text-[clamp(0.75rem,2cqw,1rem)] text-[#4a5568] sm:mb-4">
                  successfully completed and received a passing grade in
                </p>
                <h4 className="m-0 mb-3 text-[clamp(1rem,3.5cqw,1.75rem)] font-bold text-[#1a365d] sm:mb-6">
                  {data?.course?.title || 'Course Title'}
                </h4>
                <p className="m-0 max-w-[80%] text-[clamp(0.65rem,1.8cqw,0.95rem)] leading-normal text-text-secondary">
                  a course of study offered by{' '}
                  <strong>{data?.user?.organization?.name || 'the Organization'}</strong>,
                  showcasing your commitment to excellence, innovation, and teamwork.
                </p>
              </div>

              {/* Footer */}
              <div className="relative z-[2] mt-4 flex items-end justify-between sm:mt-10">
                <div className="flex items-center gap-[clamp(10px,2.5cqw,20px)]">
                  {/* QR Code Placeholder */}
                  <div className="flex size-[clamp(32px,8cqw,64px)] items-center justify-center border border-border bg-white p-0.5 text-black">
                    <QrCode className="size-full" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="m-0 text-[clamp(0.5rem,1.5cqw,0.75rem)] font-semibold tracking-[0.5px] text-text-secondary">
                      PRESENTED ON:{' '}
                      {data
                        ? new Date(data.issuedAt).toLocaleDateString('en-US', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : ''}
                    </p>
                    <p className="m-0 text-[clamp(0.5rem,1.5cqw,0.75rem)] font-semibold tracking-[0.5px] text-text-secondary">
                      VALID CERTIFICATE ID: CERT-
                      {data?.enrollmentId?.substring(0, 8).toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="flex items-end gap-[clamp(20px,5cqw,40px)]">
                  {/* Signature */}
                  <div className="mb-[clamp(5px,1.25cqw,10px)] flex flex-col items-center">
                    <div className="mb-1 h-px w-[clamp(80px,18cqw,150px)] bg-[#2d3748] sm:mb-2" />
                    <p className="m-0 text-[clamp(0.5rem,1.6cqw,0.8rem)] font-semibold tracking-[1px] text-[#4a5568]">
                      CTO, THERAPTLY
                    </p>
                  </div>
                  {/* Gold Seal Placeholder */}
                  <Award
                    className="size-[clamp(40px,10cqw,80px)] text-[#D4AF37]"
                    fill="#FFDF00"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
