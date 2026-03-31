'use client';

import { useState, useEffect } from 'react';
import styles from './auditor-pack.module.css';

type ExportState = 'idle' | 'processing' | 'completed';

export default function AuditorExportTab() {
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');

  const startExport = async () => {
    try {
      setExportState('processing');
      setProgress(0);
      setMessage('Queued...');

      const res = await fetch('/api/auditor/export/start', { method: 'POST' });
      if (!res.ok) throw new Error('Start failed');

      const data = await res.json();
      setJobId(data.jobId);
    } catch (e) {
      console.error(e);
      setExportState('idle');
      alert('Failed to start export');
    }
  };

  const cancelExport = () => {
    // In a robust complete system, we might DELETE the job. For now, abort polling visually.
    setExportState('idle');
    setJobId(null);
  };

  useEffect(() => {
    if (exportState !== 'processing' || !jobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/auditor/export/${jobId}/status`);
        if (!res.ok) throw new Error('Status failed');
        const data = await res.json();

        setProgress(data.progress);
        setMessage(data.message);

        if (data.status === 'completed') {
          setExportState('completed');
          clearInterval(interval);
        } else if (data.status === 'failed') {
          setExportState('idle');
          alert('Export failed: ' + data.message);
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Polling error', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [exportState, jobId]);

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>System Bulk Export</h2>
      </div>

      <div className={styles.exportTabContent}>
        {exportState === 'idle' && (
          <div className={styles.idleState}>
            <div className={styles.exportIllustration}>
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--indigo)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <p className={styles.exportLabel}>Generate Full Auditor Extract</p>
            <p className={styles.exportOptionDesc}>
              Compiles all structural, staffing, compliance, and material evidence into formatted
              documents.
            </p>
            <button className={styles.startExportBtn} onClick={startExport}>
              Start Export
            </button>
          </div>
        )}

        {exportState === 'processing' && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Status</span>
              <span className={styles.progressMessage}>{message}</span>
            </div>
            <div className={styles.percentContainer}>
              <span className={styles.percentText}>{progress}%</span>
            </div>
            <div className={styles.progressBarWrapper}>
              <div className={styles.progressBarFill} style={{ width: `${progress}%` }} />
            </div>
            <button className={styles.cancelBtn} onClick={cancelExport}>
              Cancel Export
            </button>
          </div>
        )}

        {exportState === 'completed' && (
          <div className={styles.readySection}>
            <div className={styles.readyIconWrapper}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#3DA755"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className={styles.readyTitle}>Export Ready</h3>
            <p className={styles.readyDesc}>
              Your export has been successfully processed and is now available for download.
            </p>

            <div className={styles.readyActions}>
              <a
                href={`/api/auditor/export/${jobId}/download?format=docx`}
                className={styles.downloadDocxBtn}
                download
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download .docx
              </a>
              <a
                href={`/api/auditor/export/${jobId}/download?format=csv`}
                className={styles.downloadCsvBtn}
                download
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download CSV
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
