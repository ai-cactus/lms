import React from 'react';
import { getWorkerCertificates } from '@/app/actions/certificate';
import CertificateView from '@/components/dashboard/training/CertificateView';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Certificates | LMS',
};

export default async function WorkerCertificatesPage() {
  const certificates = await getWorkerCertificates();

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">My Certificates</h1>
        <p className="mt-2 text-sm text-gray-600">
          View and download your earned certificates of completion.
        </p>
      </div>

      {certificates.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 shadow-sm">
          You have not earned any certificates yet. Complete courses to earn them!
        </div>
      ) : (
        <div className="space-y-4">
          {certificates.map((cert) => (
            <CertificateView
              key={cert.id}
              certificateId={cert.id}
              courseTitle={cert.course.title}
              issuedAt={cert.issuedAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}
