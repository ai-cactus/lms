'use client';

import React, { useRef } from 'react';
import styles from '../CourseWizard.module.css';
import { Select } from '@/components/ui';

interface Document {
    id: string;
    name: string;
    type: 'pdf' | 'docx';
    status: 'analyzed';
    selected: boolean;
    file?: File;
}

interface Step2DocumentsProps {
    documents: Document[];
    onToggleSelect: (id: string) => void;
    onUpload?: (files: File[]) => void;
    isAnalyzing?: boolean;
    progress?: number;
    error?: string | null;
}

export default function Step2Documents({ documents, onToggleSelect, onUpload, isAnalyzing = false, progress = 0, error }: Step2DocumentsProps) {
    const [source, setSource] = React.useState('uploaded');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const sourceOptions = [
        { label: 'Uploaded documents', value: 'uploaded' },
        { label: 'Browse Computer', value: 'computer' }
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

    return (
        <div className={styles.stepWrapper}>
            <h2 className={styles.stepTitle}>Upload Training Documents</h2>
            <p className={styles.stepSubtitle}>
                Upload your policy or compliance documents. We will analyze them and convert them into courses and quizzes automatically.
            </p>

            <div className={styles.inputContainer}>
                <label className={styles.label}>Select file(s) from;</label>
                <div style={{ marginBottom: '40px' }}>
                    <Select
                        value={source}
                        onChange={(val) => setSource(val)}
                        options={sourceOptions}
                        className={styles.selectInput}
                    />
                </div>

                {source === 'computer' ? (
                    <div className={styles.scrollableContent}>
                        <div
                            className={styles.uploadZone}
                            onClick={() => !isAnalyzing && fileInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleDrop}
                            style={{ opacity: isAnalyzing ? 0.7 : 1, pointerEvents: isAnalyzing ? 'none' : 'auto' }}
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                style={{ display: 'none' }}
                                onChange={handleFileChange}
                                accept=".pdf,.docx"
                            />
                            <div className={styles.uploadIconWrapper}>
                                {isAnalyzing ? (
                                    <div className={styles.loadingSpinner} />
                                ) : (
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" fill="#718096" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <circle cx="12" cy="12" r="6" fill="white" />
                                        <path d="M12 15V9" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M9 12L12 9L15 12" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                )}
                            </div>
                            <p className={styles.uploadText}>
                                {isAnalyzing ? 'Check the parsing...' : (
                                    <>Drop your file here or <span className={styles.uploadLink}>Click to upload</span></>
                                )}
                            </p>
                            <p className={styles.uploadSubtext}>
                                {isAnalyzing ? 'Analyzing document structure and content...' : 'PDF, DOCX. Single file upload.'}
                            </p>

                            {isAnalyzing && (
                                <div style={{ width: '60%', height: '4px', background: '#E2E8F0', borderRadius: '2px', marginTop: '16px', overflow: 'hidden' }}>
                                    <div style={{ width: `${progress}%`, height: '100%', background: '#4C6EF5', transition: 'width 0.3s ease' }} />
                                </div>
                            )}
                        </div>

                        {error && (
                            <div style={{ marginTop: 16, padding: '12px', background: '#FED7D7', color: '#C53030', borderRadius: '8px', fontSize: '14px', textAlign: 'center', border: '1px solid #F56565' }}>
                                <strong>Upload Failed:</strong> {error}
                            </div>
                        )}

                        {/* Uploaded Files List */}
                        <div className={styles.uploadedFilesContainer}>
                            {documents.map((doc) => (
                                <div key={doc.id} className={styles.uploadedFileItem}>
                                    <div className={styles.fileLeft}>
                                        <div className={styles.fileIcon}>
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={doc.name.endsWith('.pdf') ? '#F56565' : '#4C6EF5'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" />
                                            </svg>
                                        </div>
                                        <div className={styles.uploadedFileInfo}>
                                            <span className={styles.uploadedFileName}>{doc.name}</span>
                                            <span className={styles.uploadedFileSize}>{doc.file ? `${(doc.file.size / 1024 / 1024).toFixed(2)} MB` : 'Mock File'}</span>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <input
                                            type="checkbox"
                                            checked={doc.selected}
                                            onChange={() => onToggleSelect(doc.id)}
                                            className={styles.checkbox}
                                            disabled={isAnalyzing}
                                        />
                                        <button className={styles.trashBtn} disabled={isAnalyzing}>
                                            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M2.5 4H13.5" />
                                                <path d="M6.5 7V11" />
                                                <path d="M9.5 7V11" />
                                                <path d="M3.5 4L4.5 13C4.5 13.55 4.95 14 5.5 14H10.5C11.05 14 11.5 13.55 11.5 13L12.5 4" />
                                                <path d="M6 4V2.5C6 2.22386 6.22386 2 6.5 2H9.5C9.77614 2 10 2.22386 10 2.5V4" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className={styles.fileList}>
                        {/* Placeholder for 'Uploaded Documents' tab if needed */}
                        <p style={{ textAlign: 'center', color: '#718096', marginTop: 40 }}>No previously uploaded documents found.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
