'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { getStandardManualHistory } from '@/app/actions/standard-manual';

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
    <div className="space-y-6 max-w-4xl mx-auto py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Standard Manual Management</h1>
        <p className="text-muted-foreground mt-2">
          Upload and manage the central Standard Manual PDF used by the RAG AI pipeline.
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-md mb-6 ${
            message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold leading-none tracking-tight">Upload New Manual</h2>
          <p className="text-sm text-gray-500 mt-2">
            Uploading a new manual will deactivate the previous one and start the vector indexing
            process.
          </p>
        </div>
        <div className="p-6 pt-4">
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid gap-2">
              <label
                htmlFor="version"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
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
            <div className="grid gap-2">
              <label
                htmlFor="file"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                PDF Document
              </label>
              <input
                id="file"
                type="file"
                accept="application/pdf"
                className="flex h-10 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold leading-none tracking-tight">Version History</h2>
          <p className="text-sm text-gray-500 mt-2">Previously uploaded standard manuals</p>
        </div>
        <div className="p-6 pt-4">
          {isLoadingHistory ? (
            <p className="text-sm text-gray-500">Loading history...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-500">No manuals uploaded yet.</p>
          ) : (
            <div className="divide-y divide-gray-200">
              {history.map((manual) => (
                <div key={manual.id} className="py-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium flex items-center gap-2 text-gray-900">
                      {manual.filename}
                      {manual.isActive && (
                        <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-gray-900 text-white hover:bg-gray-900/80">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      Version: {manual.version} • Uploaded:{' '}
                      {new Date(manual.createdAt).toLocaleDateString()}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      Status:{' '}
                      {manual.processedAt ? (
                        <span className="text-green-600">Indexed ({manual.chunkCount} chunks)</span>
                      ) : (
                        <span className="text-amber-600 animate-pulse">Processing...</span>
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
