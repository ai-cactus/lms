'use client';

import React, { useRef } from 'react';
import { Folder, FileText, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { Select } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import Link from 'next/link';

import { CourseDocument } from '@/types/course';

interface Step2DocumentsProps {
  documents: CourseDocument[];
  onToggleSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onUpload?: (files: File[]) => void;
  isAnalyzing?: boolean;
  progress?: number;
  error?: string | null;
  isScanningPhi?: boolean;
}

export default function Step2Documents({
  documents,
  onToggleSelect,
  onDelete,
  onUpload,
  isAnalyzing = false,
  progress = 0,
  error,
  isScanningPhi,
}: Step2DocumentsProps) {
  const [source, setSource] = React.useState('uploaded');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sourceOptions = [
    { label: 'Uploaded documents', value: 'uploaded' },
    { label: 'Browse Computer', value: 'computer' },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onUpload) {
      onUpload(Array.from(e.target.files));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && onUpload) {
      onUpload(Array.from(e.dataTransfer.files));
    }
  };

  // Auto-switch to list view if a document is selected (e.g. after upload)
  React.useEffect(() => {
    if (source === 'computer' && documents.some((d) => d.selected)) {
      setSource('uploaded');
    }
  }, [documents, source]);

  return (
    <div className="relative z-50 flex w-full max-w-[800px] flex-col items-center transition-[max-width] duration-300">
      <h2 className="mb-5 shrink-0 text-center text-[32px] font-bold tracking-[-0.5px] text-[#1a202c] [font-family:var(--font-heading)]">
        Upload Training Documents
      </h2>
      <p className="mb-[30px] shrink-0 max-w-[600px] text-center text-base leading-normal text-[#4a5568]">
        Upload your policy or compliance documents. We will analyze them and convert them into
        courses and quizzes automatically.
      </p>

      <div className="relative z-30 flex min-h-0 w-full max-w-[500px] flex-1 flex-col">
        <label className="mb-2 block shrink-0 text-sm text-[#718096]">Select file(s) from;</label>
        <div className="mb-10">
          <Select value={source} onChange={(val) => setSource(val)} options={sourceOptions} />
        </div>

        {source === 'computer' ? (
          <div>
            <div
              className="flex h-[180px] w-full shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#e2e8f0] bg-[#fafcfe] transition-all hover:border-[#4c6ef5] hover:bg-[#f8fafc]"
              onClick={() => !isAnalyzing && fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              style={{
                opacity: isAnalyzing ? 0.7 : 1,
                pointerEvents: isAnalyzing ? 'none' : 'auto',
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
                accept=".pdf,.docx"
              />
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-[#f7fafc]">
                {isAnalyzing ? (
                  <Loader2 className="size-8 animate-spin text-[#4c6ef5]" />
                ) : (
                  <Folder className="size-8 text-[#718096]" />
                )}
              </div>
              <p className="mb-2 text-balance text-center text-base font-medium text-[#1a202c]">
                {isAnalyzing ? (
                  'Check the parsing...'
                ) : (
                  <>
                    Drop your file here or{' '}
                    <span className="cursor-pointer text-[#4c6ef5] underline">Click to upload</span>
                  </>
                )}
              </p>
              <p className="text-balance text-center text-sm text-[#718096]">
                {isAnalyzing
                  ? 'Analyzing document structure and content...'
                  : 'PDF, DOCX. Single file upload.'}
              </p>

              {isAnalyzing && (
                <div className="w-3/5 h-1 bg-[#E2E8F0] rounded-sm mt-4 overflow-hidden">
                  <div
                    style={{
                      width: `${progress}%`,
                      height: '100%',
                      background: '#4C6EF5',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 p-3 bg-[#FED7D7] text-[#C53030] rounded-lg text-sm text-center border border-[#F56565]">
                <strong>Upload Failed:</strong> {error}
              </div>
            )}
          </div>
        ) : (
          <div>
            {documents.length > 0 ? (
              <div className="mt-6 max-h-none min-h-0 w-full flex-1 overflow-y-auto rounded-xl border-2 border-dashed border-[#e2e8f0] bg-white px-6 py-2">
                {documents.slice(0, 4).map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between border-b border-[#edf2f7] py-6 last:border-b-0"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center justify-center">
                        <FileText
                          className="size-6"
                          style={{ color: doc.name.endsWith('.pdf') ? '#F56565' : '#4C6EF5' }}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-[#1a202c]">{doc.name}</span>
                        <span className="text-[13px] text-[#718096]">
                          {doc.file ? `${(doc.file.size / 1024 / 1024).toFixed(2)} MB` : ''}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={doc.selected}
                        onCheckedChange={() => onToggleSelect(doc.id)}
                        className="size-5 cursor-pointer data-[state=checked]:border-[#4c6ef5] data-[state=checked]:bg-[#4c6ef5]"
                        disabled={isAnalyzing}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-9 rounded-lg text-[#a0aec0] transition-all hover:bg-[#fff5f5] hover:text-[#e53e3e]"
                        disabled={isAnalyzing}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete?.(doc.id);
                        }}
                      >
                        <Trash2 className="size-[18px]" />
                      </Button>
                    </div>
                  </div>
                ))}
                {documents.length > 4 && (
                  <div className="text-center my-5">
                    <Link
                      href="/dashboard/documents"
                      className="text-[#4C6EF5] no-underline font-medium text-sm"
                    >
                      View more in Document Hub →
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center text-slate-500 mt-10">
                No previously uploaded documents found.
              </p>
            )}
          </div>
        )}
      </div>

      {isScanningPhi && (
        <div className="mt-4 flex w-full items-center gap-4 rounded-xl border border-[#e2e8f0] bg-white p-4">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef2ff]">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
                fill="white"
              />
              <path
                d="M10.5 15.5L14.5 11.5M10.5 11.5L14.5 15.5"
                stroke="#4F46E5"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <Sparkles className="absolute -right-[5px] -top-[5px] size-3.5 text-[#f59e0b]" />
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold text-[#1a202c]">Scanning...</h4>
            <p className="text-[13px] text-[#718096]">
              Ensuring document does not contain personal health information
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
