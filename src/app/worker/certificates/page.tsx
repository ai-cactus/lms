import React from 'react';
import { getWorkerCertificates } from '@/app/actions/certificate';
import CertificateCardList from '@/components/dashboard/training/CertificateCardList';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Certificates | LMS',
};

export default async function WorkerCertificatesPage() {
  const certificates = await getWorkerCertificates();

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <CertificateCardList
        certificates={certificates}
        title="Certificates"
        description="Here's a quick summary of your earned certificates."
      />
    </div>
  );
}
