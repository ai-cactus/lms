'use client';

import { useState, useEffect } from 'react';
import styles from './auditor-pack.module.css';
import { logger } from '@/lib/logger';
import { generateAndEmailAuditorPackPdf } from '@/app/actions/auditor';

type ExportState = 'idle' | 'processing' | 'completed';

export default function AuditorExportTab() {
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  // PDF email export state (independent of the DOCX/CSV bulk export)
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfFeedback, setPdfFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

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
      logger.error({ msg: 'Error:', err: e });
      setExportState('idle');
      alert('Failed to start export');
    }
  };

  const cancelExport = () => {
    // In a robust complete system, we might DELETE the job. For now, abort polling visually.
    setExportState('idle');
    setJobId(null);
  };

  // Generate a full auditor pack PDF and email it to the admin
  const handlePdfExport = async () => {
    setPdfExporting(true);
    setPdfFeedback(null);
    try {
      const result = await generateAndEmailAuditorPackPdf();
      setPdfFeedback({
        ok: result.success,
        msg: result.success
          ? 'Auditor pack PDF sent to your email successfully.'
          : (result.error ?? 'Failed to generate PDF. Please try again.'),
      });
    } catch (err) {
      logger.error({ msg: '[auditor] PDF export client error', err });
      setPdfFeedback({ ok: false, msg: 'An unexpected error occurred.' });
    } finally {
      setPdfExporting(false);
      setTimeout(() => setPdfFeedback(null), 8000);
    }
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
        logger.error({ msg: 'Polling error', err: err });
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
            {/* ── Existing: Full DOCX/CSV bulk export ── */}
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
              Start Export (DOCX / CSV)
            </button>

            {/* ── New: PDF via Email ── */}
            <div
              style={{
                marginTop: '24px',
                paddingTop: '24px',
                borderTop: '1px solid #E2E8F0',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#3182CE"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#2D3748' }}>
                  Export as PDF &amp; Email to me
                </span>
              </div>
              <p style={{ fontSize: '13px', color: '#718096', margin: '0', textAlign: 'center' }}>
                Generates a formatted PDF of all staff learning activity and sends it to your admin
                email address.
              </p>
              <button
                onClick={handlePdfExport}
                disabled={pdfExporting}
                style={{
                  marginTop: '4px',
                  padding: '9px 24px',
                  background: pdfExporting ? '#93C5FD' : '#3182CE',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: pdfExporting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'background 0.2s',
                }}
              >
                {pdfExporting ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ animation: 'spin 1s linear infinite' }}
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
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
                )}
                {pdfExporting ? 'Generating PDF…' : 'Send PDF to Email'}
              </button>
              {pdfFeedback && (
                <p
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: pdfFeedback.ok ? '#276749' : '#C53030',
                    margin: '0',
                    textAlign: 'center',
                  }}
                >
                  {pdfFeedback.ok ? '✓ ' : '✗ '}
                  {pdfFeedback.msg}
                </p>
              )}
            </div>
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
