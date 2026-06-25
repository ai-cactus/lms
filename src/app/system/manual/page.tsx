'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { getStandardManualHistory } from '@/app/actions/standard-manual';
import { logger } from '@/lib/logger';

interface ManualHistory {
  id: string;
  filename: string;
  version: string;
  isActive: boolean;
  createdAt: string | Date;
  processedAt: string | Date | null;
  chunkCount: number;
  uploadedBy: string;
}

// Poll every 8 s while any manual is still processing
const POLL_INTERVAL_MS = 8000;

export default function StandardManualPage() {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [history, setHistory] = useState<ManualHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await getStandardManualHistory();
      setHistory(data as ManualHistory[]);
      return data;
    } catch (error) {
      logger.error({ msg: 'Failed to load history:', err: error });
      setMessage({ type: 'error', text: 'Failed to load manual history' });
      return [];
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // Start/stop polling based on whether any manual is still processing
  const syncPollState = useCallback(
    (data: ManualHistory[]) => {
      const hasProcessing = data.some((m) => !m.processedAt && m.isActive);

      if (hasProcessing && !pollRef.current) {
        pollRef.current = setInterval(async () => {
          const updated = await fetchHistory();
          const stillProcessing = (updated as ManualHistory[]).some(
            (m) => !m.processedAt && m.isActive,
          );
          if (!stillProcessing && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }, POLL_INTERVAL_MS);
      } else if (!hasProcessing && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    },
    [fetchHistory],
  );

  useEffect(() => {
    fetchHistory().then((data) => syncPollState(data as ManualHistory[]));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchHistory, syncPollState]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !version.trim()) return;

    setIsUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('version', version.trim());

    try {
      const res = await fetch('/api/system/manual', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setMessage({ type: 'success', text: data.message });
      setFile(null);
      setVersion('');

      // Refresh history then start polling since indexing is now queued
      const updated = await fetchHistory();
      syncPollState(updated as ManualHistory[]);
    } catch (error: unknown) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Upload failed' });
    } finally {
      setIsUploading(false);
    }
  };

  const activeManual = history.find((m) => m.isActive);

  return (
    <div className="mx-auto max-w-[800px] p-4 md:p-8">
      <div className="mb-8">
        <h1 className="font-heading text-[28px] font-bold tracking-[-0.5px] text-[#0f172a]">
          Standard Manual Management
        </h1>
        <p className="mt-1.5 text-sm leading-normal text-[#64748b]">
          Upload and manage the central Standard Manual PDF used by the RAG AI pipeline.
        </p>
      </div>

      {/* Active Manual Status Banner */}
      {activeManual && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#94a3b8]">
              Active Manual
            </span>
            <span className="text-[13px] font-semibold text-[#0f172a]">
              {activeManual.filename}
            </span>
            <span className="rounded-xl bg-[#e2e8f0] px-2 py-0.5 text-xs text-[#64748b]">
              v{activeManual.version}
            </span>
          </div>
          <div className="shrink-0">
            {activeManual.processedAt ? (
              <span className="text-[13px] font-medium text-[#166534]">
                ✓ Indexed &mdash; {activeManual.chunkCount} chunks ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#b45309]">
                <Loader2 className="size-2.5 animate-spin" aria-hidden="true" /> Indexing in
                progress&hellip;
              </span>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="mb-6">
          <Alert variant={message.type === 'success' ? 'success' : 'error'}>{message.text}</Alert>
        </div>
      )}

      <div className="mb-6 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="border-b border-[#e2e8f0] px-6 py-5">
          <h2 className="text-[17px] font-semibold text-[#0f172a]">Upload New Manual</h2>
          <p className="mt-1 text-[13px] leading-normal text-[#64748b]">
            Uploading a new manual deactivates the previous one and queues vector indexing. The page
            will update automatically when indexing completes.
          </p>
        </div>
        <div className="p-6">
          <form onSubmit={handleUpload} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="version" className="text-[13px] font-medium text-[#334155]">
                Version Tag
              </label>
              <Input
                id="version"
                placeholder="e.g., v2025-04"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="file" className="text-[13px] font-medium text-[#334155]">
                PDF Document
              </label>
              <input
                id="file"
                type="file"
                accept="application/pdf"
                className="w-full cursor-pointer rounded-lg border border-[#e2e8f0] px-3.5 py-2.5 text-[13px] text-[#334155] outline-none transition-colors focus:border-[#4c6ef5] focus:shadow-[0_0_0_3px_rgba(76,110,245,0.1)]"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
              />
              {file && (
                <p className="mt-0.5 text-xs text-[#64748b]">
                  {file.name} &mdash; {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={isUploading || !file || !version.trim()}
              loading={isUploading}
            >
              {isUploading ? 'Uploading...' : 'Upload & Queue Indexing'}
            </Button>
          </form>
        </div>
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="border-b border-[#e2e8f0] px-6 py-5">
          <h2 className="text-[17px] font-semibold text-[#0f172a]">Version History</h2>
          <p className="mt-1 text-[13px] leading-normal text-[#64748b]">
            Previously uploaded standard manuals
          </p>
        </div>
        <div className="p-6">
          {isLoadingHistory ? (
            <p className="text-sm text-[#64748b]">Loading history&hellip;</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-[#64748b]">No manuals uploaded yet.</p>
          ) : (
            <div className="flex flex-col">
              {history.map((manual) => (
                <div
                  key={manual.id}
                  className="flex items-center justify-between border-b border-[#f1f5f9] py-4 last:border-b-0"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#0f172a]">
                      {manual.filename}
                      {manual.isActive && (
                        <span className="inline-flex items-center rounded-full bg-[#0f172a] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.4px] text-white">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#64748b]">
                      Version: {manual.version} &bull; Uploaded:{' '}
                      {new Date(manual.createdAt).toLocaleDateString()} &bull; By:{' '}
                      {manual.uploadedBy}
                    </div>
                    <div className="text-xs text-[#64748b]">
                      {manual.processedAt ? (
                        manual.chunkCount > 0 ? (
                          <span className="font-medium text-[#166534]">
                            ✓ Indexed ({manual.chunkCount} chunks) &mdash;{' '}
                            {new Date(manual.processedAt).toLocaleString()}
                          </span>
                        ) : (
                          <span className="font-medium text-[#ef4444]">
                            ✗ Indexing Failed &mdash;{' '}
                            {new Date(manual.processedAt).toLocaleString()}
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#b45309]">
                          <Loader2 className="size-2.5 animate-spin" aria-hidden="true" /> Indexing
                          in queue&hellip;
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
