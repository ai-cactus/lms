'use client';

import { useState, useEffect } from 'react';
import { FileText, Download, Loader2, Mail, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
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
    <div className="rounded-xl border border-border bg-background p-6">
      <div className="mb-5">
        <h2 className="text-base font-bold text-foreground">System Bulk Export</h2>
      </div>

      <div className="flex flex-col items-center justify-center px-6 py-20">
        {exportState === 'idle' && (
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            {/* ── Existing: Full DOCX/CSV bulk export ── */}
            <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
              <FileText className="size-10 text-primary" aria-hidden="true" />
            </div>
            <p className="text-lg font-bold text-foreground">Generate Full Auditor Extract</p>
            <p className="text-sm text-text-secondary">
              Compiles all structural, staffing, compliance, and material evidence into formatted
              documents.
            </p>
            <Button className="mt-3" onClick={startExport}>
              Start Export (DOCX / CSV)
            </Button>

            {/* ── New: PDF via Email ── */}
            <div className="mt-6 flex w-full flex-col items-center gap-2 border-t border-border pt-6">
              <div className="flex items-center gap-2">
                <Mail className="size-[22px] text-[#3182CE]" aria-hidden="true" />
                <span className="text-sm font-semibold text-foreground">
                  Export as PDF &amp; Email to me
                </span>
              </div>
              <p className="m-0 text-center text-[13px] text-text-secondary">
                Generates a formatted PDF of all staff learning activity and sends it to your admin
                email address.
              </p>
              <button
                onClick={handlePdfExport}
                disabled={pdfExporting}
                className="mt-1 inline-flex items-center gap-2 rounded-lg bg-[#3182CE] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2c6cb0] disabled:cursor-not-allowed disabled:bg-[#93C5FD]"
              >
                {pdfExporting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-3.5" aria-hidden="true" />
                )}
                {pdfExporting ? 'Generating PDF…' : 'Send PDF to Email'}
              </button>
              {pdfFeedback && (
                <Alert
                  variant={pdfFeedback.ok ? 'success' : 'error'}
                  className="mt-1 w-full max-w-[480px] text-left"
                >
                  {pdfFeedback.msg}
                </Alert>
              )}
            </div>
          </div>
        )}

        {exportState === 'processing' && (
          <div className="w-full max-w-[480px] rounded-xl border border-border bg-background p-6 text-left">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-primary">Status</span>
              <span className="text-sm text-foreground">{message}</span>
            </div>
            <div className="mb-2 flex justify-end">
              <span className="text-sm font-semibold text-primary">{progress}%</span>
            </div>
            <div className="mb-6 h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <Button variant="outline" className="w-full" onClick={cancelExport}>
              Cancel Export
            </Button>
          </div>
        )}

        {exportState === 'completed' && (
          <div className="flex w-full max-w-[480px] flex-col items-center rounded-xl border border-success/40 bg-success/10 px-6 py-8 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-background/50">
              <Check className="size-8 text-success" aria-hidden="true" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-foreground">Export Ready</h3>
            <p className="mb-6 text-sm leading-relaxed text-text-secondary">
              Your export has been successfully processed and is now available for download.
            </p>

            <div className="flex w-full gap-3">
              <a
                href={`/api/auditor/export/${jobId}/download?format=docx`}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                download
              >
                <Download className="size-[18px]" aria-hidden="true" />
                Download .docx
              </a>
              <a
                href={`/api/auditor/export/${jobId}/download?format=csv`}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-primary bg-background px-3 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                download
              >
                <Download className="size-[18px]" aria-hidden="true" />
                Download CSV
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
