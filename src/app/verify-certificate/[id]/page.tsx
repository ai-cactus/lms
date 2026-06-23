import React from 'react';
import type { Metadata } from 'next';
import { BadgeCheck, ShieldX } from 'lucide-react';
import prisma from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'Verify Certificate · Theraptly',
  description: 'Verify the authenticity of a Theraptly certificate of completion.',
};

/**
 * Public certificate verification page.
 *
 * This is the destination encoded in the certificate's QR code, so it must be
 * reachable WITHOUT authentication — anyone (an employer, auditor, …) scanning
 * the code should be able to confirm the credential is genuine. Certificate ids
 * are unguessable UUIDs, and only non-sensitive, on-certificate fields are
 * exposed here (recipient, course, organisation, issue date, public id).
 */

function formatIssueDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Same human-readable id shown on the certificate artwork. */
function readableCertId(enrollmentId: string): string {
  return `CERT-${enrollmentId.substring(0, 8).toUpperCase()}`;
}

const CloverLogo = () => (
  <div className="flex items-center justify-center gap-2.5">
    <svg width={34} height={34} viewBox="25 25 94 94" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M57.401 26.665C52.1501 26.665 47.1144 28.7001 43.4015 32.3224L25.4853 49.8015V57.8023C25.4853 63.4549 27.974 68.5403 31.9408 72.0725C27.974 75.6048 25.4853 80.6902 25.4853 86.3428V94.3436L43.4015 111.823C47.1144 115.445 52.1501 117.48 57.401 117.48C63.1949 117.48 68.4075 115.052 72.028 111.182C75.6486 115.052 80.8611 117.48 86.655 117.48C91.9059 117.48 96.9416 115.445 100.655 111.823L118.571 94.3436V86.3428C118.571 80.6902 116.082 75.6048 112.115 72.0725C116.082 68.5403 118.571 63.4549 118.571 57.8023V49.8015L100.655 32.3224C96.9416 28.7001 91.9059 26.665 86.655 26.665C80.8611 26.665 75.6486 29.0931 72.028 32.9631C68.4075 29.0931 63.1949 26.665 57.401 26.665ZM77.1994 94.3436V98.1646C77.1994 103.259 81.4329 107.39 86.655 107.39C89.1627 107.39 91.5678 106.418 93.3411 104.688L108.228 90.1638V86.3428C108.228 81.248 103.994 77.1178 98.7724 77.1178C96.2647 77.1178 93.8596 78.0897 92.0863 79.8197L77.1994 94.3436ZM66.8567 94.3436L51.9697 79.8197C50.1965 78.0897 47.7915 77.1178 45.2837 77.1178C40.0615 77.1178 35.8281 81.248 35.8281 86.3428V90.1638L50.7149 104.688C52.4882 106.418 54.8933 107.39 57.401 107.39C62.6231 107.39 66.8567 103.259 66.8567 98.1646V94.3436ZM66.8567 45.9805V49.8015L51.9697 64.3253C50.1965 66.0554 47.7915 67.0273 45.2837 67.0273C40.0615 67.0273 35.8281 62.897 35.8281 57.8023V53.9813L50.7149 39.4575C52.4882 37.7275 54.8933 36.7556 57.401 36.7556C62.6231 36.7556 66.8567 40.8857 66.8567 45.9805ZM92.0863 64.3253L77.1994 49.8015V45.9805C77.1994 40.8857 81.4329 36.7556 86.655 36.7556C89.1627 36.7556 91.5678 37.7275 93.3411 39.4575L108.228 53.9813V57.8023C108.228 62.897 103.994 67.0273 98.7724 67.0273C96.2647 67.0273 93.8596 66.0554 92.0863 64.3253Z"
        fill="#0066FF"
      />
    </svg>
    <span className="text-2xl font-bold tracking-tight text-foreground">Theraptly</span>
  </div>
);

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border-light py-4 last:border-b-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-lg font-medium text-foreground">{value}</p>
    </div>
  );
}

export default async function VerifyCertificatePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const certificate = await prisma.certificate.findUnique({
    where: { id },
    select: {
      enrollmentId: true,
      issuedAt: true,
      course: { select: { title: true } },
      user: {
        select: {
          email: true,
          profile: { select: { fullName: true } },
          organization: { select: { name: true } },
        },
      },
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-secondary px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <CloverLogo />
        </div>

        {certificate ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex flex-col items-center gap-2 border-b border-border bg-success/10 px-6 py-8 text-center">
              <BadgeCheck className="size-12 text-success" aria-hidden="true" />
              <h1 className="text-2xl font-bold text-foreground">Certificate Verified</h1>
              <p className="text-sm text-text-secondary">
                This is an authentic certificate of completion issued through Theraptly.
              </p>
            </div>

            <div className="px-6 py-2">
              <Field
                label="Recipient"
                value={certificate.user.profile?.fullName || certificate.user.email}
              />
              <Field label="Course" value={certificate.course.title} />
              {certificate.user.organization?.name ? (
                <Field label="Issued by" value={certificate.user.organization.name} />
              ) : null}
              <Field label="Issued on" value={formatIssueDate(certificate.issuedAt)} />
              <Field label="Certificate ID" value={readableCertId(certificate.enrollmentId)} />
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <ShieldX className="size-12 text-error" aria-hidden="true" />
              <h1 className="text-2xl font-bold text-foreground">Certificate Not Found</h1>
              <p className="max-w-sm text-sm text-text-secondary">
                We couldn&apos;t verify a certificate with this identifier. Please check that the
                link or QR code is correct and complete.
              </p>
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-text-secondary">
          Verified via Theraptly · The authenticity of this certificate is confirmed.
        </p>
      </div>
    </div>
  );
}
