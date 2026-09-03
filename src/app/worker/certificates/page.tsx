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
    <div className="mx-auto w-full max-w-[1068px] py-8 px-4 sm:px-6 lg:px-8">
      <CertificateCardList
        certificates={certificates}
        title="Certificates"
        description="Here's a brief overview of your certificates on the platform."
      />
    </div>
  );
}
