'use client';

import { useState, useEffect } from 'react';
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
}

export default function StandardManualPage() {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [history, setHistory] = useState<ManualHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchHistory = async () => {
    try {
      const data = await getStandardManualHistory();
      setHistory(data);
    } catch (error) {
      console.error('Failed to load history:', error);
      setMessage({ type: 'error', text: 'Failed to load manual history' });
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !version) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('version', version);

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
      // Refresh history slightly later to allow processing state to show
      setTimeout(fetchHistory, 1000);
    } catch (error: unknown) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Upload failed' });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Standard Manual Management</h1>
        <p className={styles.pageDescription}>
          Upload and manage the central Standard Manual PDF used by the RAG AI pipeline.
        </p>
      </div>

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
            Uploading a new manual will deactivate the previous one and start the vector indexing
            process.
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
            </div>
            <Button type="submit" disabled={isUploading || !file || !version} loading={isUploading}>
              {isUploading ? 'Uploading...' : 'Upload & Index'}
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
            <p className={styles.stateText}>Loading history...</p>
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
                      {new Date(manual.createdAt).toLocaleDateString()}
                    </div>
                    <div className={styles.historyStatus}>
                      Status:{' '}
                      {manual.processedAt ? (
                        <span className={styles.statusIndexed}>
                          Indexed ({manual.chunkCount} chunks)
                        </span>
                      ) : (
                        <span className={styles.statusProcessing}>Processing...</span>
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
