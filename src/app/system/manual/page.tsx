'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { getStandardManualHistory } from '@/app/actions/standard-manual';
import styles from './manual.module.css';

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
      console.error('Failed to load history:', error);
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
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Standard Manual Management</h1>
        <p className={styles.pageDescription}>
          Upload and manage the central Standard Manual PDF used by the RAG AI pipeline.
        </p>
      </div>

      {/* Active Manual Status Banner */}
      {activeManual && (
        <div className={styles.statusBanner}>
          <div className={styles.statusBannerContent}>
            <span className={styles.statusBannerLabel}>Active Manual</span>
            <span className={styles.statusBannerFilename}>{activeManual.filename}</span>
            <span className={styles.statusBannerVersion}>v{activeManual.version}</span>
          </div>
          <div className={styles.statusBannerState}>
            {activeManual.processedAt ? (
              <span className={styles.statusIndexed}>
                ✓ Indexed &mdash; {activeManual.chunkCount} chunks ready
              </span>
            ) : (
              <span className={styles.statusProcessing}>
                <span className={styles.spinner} /> Indexing in progress&hellip;
              </span>
            )}
          </div>
        </div>
      )}

      {message && (
        <div
          className={`${styles.alert} ${message.type === 'success' ? styles.alertSuccess : styles.alertError}`}
        >
          {message.text}
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Upload New Manual</h2>
          <p className={styles.cardSubtitle}>
            Uploading a new manual deactivates the previous one and queues vector indexing. The page
            will update automatically when indexing completes.
          </p>
        </div>
        <div className={styles.cardBody}>
          <form onSubmit={handleUpload} className={styles.form}>
            <div className={styles.fieldGroup}>
              <label htmlFor="version" className={styles.fieldLabel}>
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
            <div className={styles.fieldGroup}>
              <label htmlFor="file" className={styles.fieldLabel}>
                PDF Document
              </label>
              <input
                id="file"
                type="file"
                accept="application/pdf"
                className={styles.fileInput}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
              />
              {file && (
                <p className={styles.fileInfo}>
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

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Version History</h2>
          <p className={styles.cardSubtitle}>Previously uploaded standard manuals</p>
        </div>
        <div className={styles.cardBody}>
          {isLoadingHistory ? (
            <p className={styles.stateText}>Loading history&hellip;</p>
          ) : history.length === 0 ? (
            <p className={styles.stateText}>No manuals uploaded yet.</p>
          ) : (
            <div className={styles.historyList}>
              {history.map((manual) => (
                <div key={manual.id} className={styles.historyItem}>
                  <div className={styles.historyMeta}>
                    <div className={styles.historyFilename}>
                      {manual.filename}
                      {manual.isActive && <span className={styles.badgeActive}>Active</span>}
                    </div>
                    <div className={styles.historyDetails}>
                      Version: {manual.version} &bull; Uploaded:{' '}
                      {new Date(manual.createdAt).toLocaleDateString()} &bull; By:{' '}
                      {manual.uploadedBy}
                    </div>
                    <div className={styles.historyStatus}>
                      {manual.processedAt ? (
                        <span className={styles.statusIndexed}>
                          ✓ Indexed ({manual.chunkCount} chunks) &mdash;{' '}
                          {new Date(manual.processedAt).toLocaleString()}
                        </span>
                      ) : (
                        <span className={styles.statusProcessing}>
                          <span className={styles.spinner} /> Indexing in queue&hellip;
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
