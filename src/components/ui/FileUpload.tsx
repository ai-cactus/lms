'use client';

import React, { useRef, useState, DragEvent, ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;

  error?: string;
  description?: string;
}

export default function FileUpload({
  onFilesSelected,
  accept = '*/*',
  multiple = true,

  error,
  description,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    validateAndPassFiles(droppedFiles);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      validateAndPassFiles(selectedFiles);
    }
  };

  const validateAndPassFiles = (files: File[]) => {
    // Here you could add size validation or type validation if needed
    onFilesSelected(files);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'flex min-h-[200px] cursor-pointer items-center justify-center rounded-xl border border-dashed p-10 transition-all',
          error
            ? 'border-destructive bg-error/5'
            : isDragging
              ? 'scale-[0.995] border-primary bg-primary/5'
              : 'border-input bg-background-secondary hover:border-primary hover:bg-primary/5',
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick} // Make the whole area clickable for better UX
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInputChange}
        />

        <div className="flex flex-col items-center gap-3 text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-accent text-text-secondary">
            <Upload className="size-6" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-text-secondary">
            Drop your files here or <span className="text-primary underline">Click to upload</span>
          </p>
          <p className="text-xs text-text-tertiary">
            {description || 'PDF, DOCX, JPG, PNG. You may upload multiple files.'}
          </p>
        </div>
      </div>
      {error && <p className="ml-1 text-xs text-error">{error}</p>}
    </div>
  );
}
