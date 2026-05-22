'use client';

import React from 'react';
import { Button } from '@/components/ui';

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
        <Button
          variant="outline"
          onClick={() => window.open(`/api/certificates/${certificateId}`, '_blank')}
        >
          View PDF
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            const a = document.createElement('a');
            a.href = `/api/certificates/${certificateId}`;
            a.download = `Certificate-${courseTitle.replace(/\s+/g, '-')}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }}
        >
          Download
        </Button>
      </div>
    </div>
  );
}
