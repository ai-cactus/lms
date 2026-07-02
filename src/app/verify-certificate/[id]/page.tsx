import React from 'react';
import type { Metadata } from 'next';
import { BadgeCheck, ShieldX } from 'lucide-react';
import prisma from '@/lib/prisma';
import Logo from '@/components/ui/Logo';
import { formatCertificateId } from '@/lib/certificate-id';

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
        <div className="mb-8 flex justify-center">
          <Logo size="lg" variant="blue" />
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
              <Field label="Certificate ID" value={formatCertificateId(certificate.enrollmentId)} />
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
