'use client';

import { useEffect, useState } from 'react';
import { Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateOrganizationCode, getOrganizationCode } from '@/app/actions/organization-code';
import { logger } from '@/lib/logger';

/**
 * The temporary join code workers enter to attach themselves to the
 * organization. Kept on the My Organization panel so the code stays reachable
 * for the roles that can hand it out.
 */
export default function OrgCodeGenerator() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCode() {
      try {
        const result = await getOrganizationCode();
        if (result.success && result.code) {
          setCode(result.code);
          setExpiresAt(result.expiresAt ? new Date(result.expiresAt) : null);
        }
      } catch (err) {
        logger.error({ msg: '[org] Error loading join code', err });
      }
    }
    loadCode();
  }, []);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await generateOrganizationCode();
      if (result.success && result.code) {
        setCode(result.code);
        setExpiresAt(result.expiresAt ? new Date(result.expiresAt) : null);
      } else {
        setError(result.error || 'Failed to generate code');
      }
    } catch {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  }

  const isExpired = expiresAt !== null && new Date() > expiresAt;
  const minutesLeft = expiresAt
    ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000))
    : 0;

  const copyToClipboard = () => {
    if (code) navigator.clipboard.writeText(code);
  };

  return (
    <div className="w-full">
      {code ? (
        <div
          className={`flex flex-col gap-3 rounded-[10px] border p-4 ${
            isExpired ? 'border-error/40 bg-error/5' : 'border-border bg-background-secondary'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-2xl font-semibold tracking-[0.2em] text-foreground">
              {code}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={copyToClipboard}
              aria-label="Copy code"
            >
              <Copy className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {isExpired ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-error">
                <TriangleAlert className="size-3.5" aria-hidden="true" /> Expired
              </span>
            ) : (
              <span className="text-sm text-text-secondary">
                Expires in {Math.floor(minutesLeft / 60)}h {minutesLeft % 60}m
              </span>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw
                className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {isExpired ? 'Regenerate' : 'Generate New'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-text-secondary">
            Generate a temporary 6-digit code for workers to join your organization.
          </p>
          <Button type="button" onClick={handleGenerate} loading={loading}>
            Generate Code
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
