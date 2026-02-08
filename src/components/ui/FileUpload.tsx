'use client';

import React, { useRef, useState, DragEvent, ChangeEvent } from 'react';
import styles from './FileUpload.module.css';

interface FileUploadProps {
    onFilesSelected: (files: File[]) => void;
    accept?: string;
    multiple?: boolean;
    maxSizeInMB?: number;
    error?: string;
    description?: string;
}

export default function FileUpload({
    onFilesSelected,
    accept = '*/*',
    multiple = true,
    maxSizeInMB = 5,
    error,
    description
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
        <div className={styles.container}>
            <div
                className={`${styles.dropzone} ${isDragging ? styles.active : ''} ${error ? styles.error : ''}`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={handleClick} // Make the whole area clickable for better UX
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    className={styles.hiddenInput}
                    accept={accept}
                    multiple={multiple}
                    onChange={handleFileInputChange}
                />

                <div className={styles.content}>
                    <div className={styles.iconWrapper}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                    </div>
                    <p className={styles.text}>
                        Drop your files here or <span className={styles.link}>Click to upload</span>
                    </p>
                    <p className={styles.subtext}>
                        {description || 'PDF, DOCX, JPG, PNG. You may upload multiple files.'}
                    </p>
                </div>
            </div>
            {error && <p className={styles.errorMessage}>{error}</p>}
        </div>
    );
}
