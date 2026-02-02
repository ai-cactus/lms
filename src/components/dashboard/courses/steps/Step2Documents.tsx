'use client';

import React from 'react';
import styles from '../CourseWizard.module.css';
import { Select } from '@/components/ui';

interface Document {
    id: string;
    name: string;
    type: 'pdf' | 'docx';
    status: 'analyzed';
    selected: boolean;
}

interface Step2DocumentsProps {
    documents: Document[];
    onToggleSelect: (id: string) => void;
}

export default function Step2Documents({ documents, onToggleSelect }: Step2DocumentsProps) {
    const [source, setSource] = React.useState('uploaded');

    const sourceOptions = [
        { label: 'Uploaded documents', value: 'uploaded' },
        { label: 'Browse Computer', value: 'computer' }
    ];

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
                        <div className={styles.uploadZone}>
                            <div className={styles.uploadIconWrapper}>
                                {/* Folder Icon SVG */}
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" fill="#718096" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    <circle cx="12" cy="12" r="6" fill="white" />
                                    <path d="M12 15V9" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    <path d="M9 12L12 9L15 12" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </div>
                            <p className={styles.uploadText}>
                                Drop your files here or <span className={styles.uploadLink}>Click to upload</span>
                            </p>
                            <p className={styles.uploadSubtext}>
                                PDF, DOCX. You may upload multiple files.
                            </p>
                        </div>

                        {/* Mock Uploaded Files List */}
                        <div className={styles.uploadedFilesContainer}>
                            <div className={styles.uploadedFileItem}>
                                <div className={styles.fileLeft}>
                                    <div className={styles.fileIcon}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M14 2V8H20" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M16 13H8" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M16 17H8" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M10 9H8" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </div>
                                    <div className={styles.uploadedFileInfo}>
                                        <span className={styles.uploadedFileName}>North Carolina Division of Health Service Regulation - Mental Health Facility License.pdf</span>
                                        <span className={styles.uploadedFileSize}>1.8 MB</span>
                                    </div>
                                </div>
                                <button className={styles.trashBtn}>
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M2.5 4H13.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M6.5 7V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M9.5 7V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M3.5 4L4.5 13C4.5 13.55 4.95 14 5.5 14H10.5C11.05 14 11.5 13.55 11.5 13L12.5 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M6 4V2.5C6 2.22386 6.22386 2 6.5 2H9.5C9.77614 2 10 2.22386 10 2.5V4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                            </div>

                            <div className={styles.uploadedFileItem}>
                                <div className={styles.fileLeft}>
                                    <div className={styles.fileIcon}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M14 2V8H20" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M16 13H8" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M16 17H8" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M10 9H8" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </div>
                                    <div className={styles.uploadedFileInfo}>
                                        <span className={styles.uploadedFileName}>HIPAA Privacy & Security Compliance Certificate.docx</span>
                                        <span className={styles.uploadedFileSize}>1.8 MB</span>
                                    </div>
                                </div>
                                <button className={styles.trashBtn}>
                                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M2.5 4H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M6.5 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M9.5 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M3.5 4L4.5 13C4.5 13.55 4.95 14 5.5 14H10.5C11.05 14 11.5 13.55 11.5 13L12.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M6 4V2.5C6 2.22386 6.22386 2 6.5 2H9.5C9.77614 2 10 2.22386 10 2.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className={styles.fileList}>
                        {documents.map((doc) => (
                            <div key={doc.id} className={styles.fileItem}>
                                <div className={styles.fileLeft}>
                                    <input
                                        type="checkbox"
                                        checked={doc.selected}
                                        onChange={() => onToggleSelect(doc.id)}
                                        className={styles.checkbox}
                                    />
                                    <div className={styles.fileIcon}>
                                        {doc.type === 'pdf' ? (
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M14 2V8H20" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M16 13H8" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M16 17H8" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M10 9H8" stroke="#F56565" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        ) : (
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M14 2V8H20" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M16 13H8" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M16 17H8" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M10 9H8" stroke="#4299E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        )}
                                    </div>
                                    <div className={styles.fileInfo}>
                                        <span className={styles.fileName}>{doc.name}</span>
                                        <span className={styles.fileBadge}>
                                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 4 }}>
                                                <circle cx="6" cy="6" r="6" fill="#4C6EF5" />
                                                <path d="M3.5 6L5 7.5L8.5 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                            Analyzed
                                        </span>
                                    </div>
                                </div>
                                <button className={styles.btnPreview}>
                                    Preview
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
