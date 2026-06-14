'use client';

import React, { useState } from 'react';
import { verifySystemPassword } from '@/app/actions/system-admin';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';

export default function SystemLoginClient() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await verifySystemPassword(password);
      if (result.success) {
        router.push('/system');
        router.refresh();
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-secondary p-4">
      <div className="w-full max-w-[440px] rounded-[10px] border border-border bg-background p-8 shadow-sm">
        <div className="mb-4 flex size-12 items-center justify-center rounded-[10px] bg-primary/10">
          <Lock className="size-6 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">System Admin Access</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Enter the system admin password to manage all users and data across organizations. This
          tool is intended for staging environment use only.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {error && (
            <Alert variant="error" className="w-full">
              {error}
            </Alert>
          )}
          <Field label="Password">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter system admin password"
              autoFocus
              required
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={!password} loading={loading}>
            Access Dashboard
          </Button>
        </form>
      </div>
    </div>
  );
}
