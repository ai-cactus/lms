'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { useSession, signOut } from 'next-auth/react';
import { verifyOrganizationCode, joinOrganization } from '@/app/actions/organization-code';

interface OrgDetails {
  id: string;
  name: string;
  type?: string | null;
  services: string[];
  country?: string | null;
  phone?: string | null;
  contactName?: string | null;
}

export default function WorkerOnboardingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orgDetails, setOrgDetails] = useState<OrgDetails | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || code.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await verifyOrganizationCode(code);
      if (result.success && result.organization) {
        setOrgDetails(result.organization);
      } else {
        setError(result.error || 'Invalid code');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const { update } = useSession();

  const handleJoin = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await joinOrganization(code);
      if (result.success) {
        // Force session update to reflect new role/org
        await update();
        router.push('/worker');
        router.refresh(); // Ensure server components refresh
      } else {
        setError(result.error || 'Failed to join organization');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDiscard = () => {
    setOrgDetails(null);
    setCode('');
    setError('');
  };

  return (
    <div className="flex min-h-screen bg-background-secondary">
      <div className="relative z-10 flex w-full flex-col items-center justify-center bg-background p-6 md:p-12 lg:w-1/2">
        <div className="w-full max-w-[480px]">
          <Logo size="md" />

          <div className="my-8 md:mt-12 md:mb-8">
            <h1 className="mb-3 text-[32px] leading-tight font-bold text-foreground">
              Join your Organization
            </h1>
            <p className="text-base leading-relaxed text-text-secondary">
              Enter the 6-digit code provided by your administrator to join your team.
            </p>
          </div>

          {!orgDetails ? (
            <form onSubmit={handleVerify} className="flex flex-col gap-5">
              <Field label="Organization Code" error={error}>
                <Input
                  placeholder="Enter 6-digit code"
                  value={code}
                  onChange={(e) => {
                    // Only allow numbers
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    if (val.length <= 6) setCode(val);
                  }}
                  maxLength={6}
                  className="text-center text-2xl tracking-[4px]"
                />
              </Field>
              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={loading}
                disabled={code.length !== 6}
              >
                Find Organization
              </Button>
            </form>
          ) : (
            <div className="mt-6 rounded-xl border border-border bg-background p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
              <div className="mb-6 flex items-center gap-4 border-b border-border pb-5">
                <div className="flex size-12 items-center justify-center rounded-lg bg-background-secondary text-xl font-bold text-primary">
                  {orgDetails.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="mb-1 text-lg font-bold text-foreground">{orgDetails.name}</h3>
                  <span className="block text-[13px] text-text-secondary capitalize">
                    {orgDetails.type || 'Healthcare Organization'}
                  </span>
                </div>
              </div>

              <div className="mb-6 grid grid-cols-2 gap-5">
                {orgDetails.contactName && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold tracking-[0.5px] text-text-secondary uppercase">
                      Contact Person
                    </span>
                    <span className="text-[15px] font-medium text-foreground">
                      {orgDetails.contactName}
                    </span>
                  </div>
                )}
                {orgDetails.phone && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold tracking-[0.5px] text-text-secondary uppercase">
                      Phone Number
                    </span>
                    <a
                      href={`tel:${orgDetails.phone}`}
                      className="text-[15px] font-medium text-primary hover:underline"
                    >
                      {orgDetails.phone}
                    </a>
                  </div>
                )}
                {orgDetails.country && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold tracking-[0.5px] text-text-secondary uppercase">
                      Location
                    </span>
                    <span className="text-[15px] font-medium text-foreground">
                      {orgDetails.country}
                    </span>
                  </div>
                )}
              </div>

              {orgDetails.services.length > 0 && (
                <div className="mt-6 border-t border-border pt-5">
                  <span className="text-xs font-semibold tracking-[0.5px] text-text-secondary uppercase">
                    Services Provided
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {orgDetails.services.map((s) => (
                      <span
                        key={s}
                        className="rounded-md bg-background-secondary px-2.5 py-1.5 text-xs font-medium text-text-secondary"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="mt-4 text-sm text-error">{error}</p>}

              <div className="mt-6 flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleDiscard}
                  className="w-full"
                  disabled={loading}
                >
                  Discard
                </Button>
                <Button onClick={handleJoin} className="w-full" loading={loading}>
                  Join Organization
                </Button>
              </div>
            </div>
          )}

          <div className="mt-8 text-center">
            <p className="mb-2 text-sm text-text-secondary">Wrong account?</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/login` })}
              className="font-medium text-primary underline"
            >
              Log Out
            </Button>
          </div>
        </div>
      </div>

      <div className="relative z-0 hidden w-1/2 overflow-hidden bg-background-secondary lg:block">
        <Image
          src="/images/login-bg.png"
          alt="Theraptly Training"
          fill
          className="object-cover"
          priority
          quality={100}
        />

        <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/80 to-transparent p-16 text-white">
          <div>
            <h2 className="mb-4 text-4xl leading-tight font-bold">Welcome to the team</h2>
            <p className="mb-12 text-lg leading-relaxed opacity-90">
              Get access to your assigned training, policies, and compliance documents in one place.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
