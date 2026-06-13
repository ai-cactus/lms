'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import CertificateModal from './CertificateModal';

interface CertificateViewProps {
  certificateId: string;
  courseTitle: string;
  issuedAt: Date | string;
}

export default function CertificateView({
  certificateId,
  courseTitle,
  issuedAt,
}: CertificateViewProps) {
  const [open, setOpen] = useState(false);
  const dateStr =
    typeof issuedAt === 'string'
      ? new Date(issuedAt).toLocaleDateString()
      : issuedAt.toLocaleDateString();

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between">
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-1">Certificate of Completion</h3>
        <p className="text-gray-600 mb-2">
          For completing: <span className="font-semibold">{courseTitle}</span>
        </p>
        <p className="text-sm text-gray-500">Issued on {dateStr}</p>
      </div>

      <div className="mt-4 md:mt-0 flex gap-3">
        <Button variant="default" onClick={() => setOpen(true)}>
          View Certificate
        </Button>
      </div>

      <CertificateModal
        isOpen={open}
        onClose={() => setOpen(false)}
        certificateId={certificateId}
      />
    </div>
  );
}
