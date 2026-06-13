'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { updateRole } from '@/app/actions/user';
import { logger } from '@/lib/logger';

export default function RoleSelectionPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<'admin' | 'worker' | null>('admin');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleContinue = async () => {
    if (!selectedRole) return;
    setIsLoading(true);
    setError('');

    try {
      const result = await updateRole(selectedRole);

      if (result.success) {
        router.push('/dashboard');
      } else {
        setError(result.error || 'Failed to update role');
      }
    } catch (err) {
      logger.error({ msg: 'Unexpected error:', err: err });
      setError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const roles: { id: 'admin' | 'worker'; name: string }[] = [
    { id: 'admin', name: 'Admin' },
    { id: 'worker', name: 'Worker' },
  ];

  return (
    <div className="flex w-full justify-center px-6 py-16 md:px-[110px] md:py-[140px]">
      <div className="flex w-full max-w-[420px] flex-col items-center text-center">
        <div className="mb-6">
          <Logo size="md" />
        </div>

        <h1 className="mb-2 text-[26px] font-bold text-foreground">Tell us about your role</h1>
        <p className="mb-10 max-w-[380px] text-base leading-relaxed text-text-secondary">
          Choose the option that best describes how you wish to use Theraptly.
        </p>

        <div className="mb-10 flex w-full flex-col gap-4">
          {roles.map((role) => {
            const isSelected = selectedRole === role.id;
            return (
              <div
                key={role.id}
                className={`flex cursor-pointer flex-col gap-5 rounded-xl border p-5 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-[0_0_0_1px_var(--primary)]'
                    : 'border-border bg-background hover:border-border'
                }`}
                onClick={() => setSelectedRole(role.id)}
              >
                <div className="flex items-start justify-between">
                  <CreditCard
                    className={`size-6 ${isSelected ? 'text-primary' : 'text-text-secondary'}`}
                    aria-hidden="true"
                  />
                  <div
                    className={`flex size-5 items-center justify-center rounded-full border-[1.5px] ${
                      isSelected ? 'border-primary' : 'border-border'
                    }`}
                  >
                    {isSelected && <div className="size-2.5 rounded-full bg-primary" />}
                  </div>
                </div>
                <h3
                  className={`text-lg font-semibold ${isSelected ? 'text-primary' : 'text-foreground'}`}
                >
                  {role.name}
                </h3>
              </div>
            );
          })}
        </div>

        {error && <p className="mb-4 text-sm text-error">{error}</p>}

        <Button
          size="lg"
          className="w-full"
          onClick={handleContinue}
          loading={isLoading}
          disabled={!selectedRole}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
