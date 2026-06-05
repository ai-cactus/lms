'use client';

import React, { useState } from 'react';
import styles from './CertificateCardList.module.css';
import CertificateModal from './CertificateModal';
import { Button } from '@/components/ui';

interface CertificateData {
  id: string;
  course: {
    title: string;
  };
  issuedAt: Date | string;
}

interface CertificateCardListProps {
  certificates: CertificateData[];
  title?: string;
  description?: string;
  showExport?: boolean;
}

export default function CertificateCardList({
  certificates,
  title = 'Certificates',
  description = "Here's a quick summary of your earned certificates.",
  showExport = true,
}: CertificateCardListProps) {
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);

  const formatIssueDate = (dateString: Date | string) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatIssueTime = (dateString: Date | string) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const handleExportAll = () => {
    // Basic CSV export for demonstration
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      'Certificate ID,Course,Issued Date\n' +
      certificates
        .map((c) => `${c.id},"${c.course.title}",${new Date(c.issuedAt).toISOString()}`)
        .join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'certificates_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>
        {showExport && (
          <div className={styles.actions}>
            <div className={styles.filterGroup}>
              <select className={styles.select}>
                <option>Last 7 days</option>
                <option>Last 30 days</option>
                <option>All time</option>
              </select>
            </div>
            <Button variant="outline" className={styles.exportBtn} onClick={handleExportAll}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export
            </Button>
          </div>
        )}
      </div>

      {certificates.length === 0 ? (
        <div className={styles.emptyState}>No certificates available.</div>
      ) : (
        <div className={styles.list}>
          {certificates.map((cert) => (
            <div key={cert.id} className={styles.card} onClick={() => setSelectedCertId(cert.id)}>
              <div className={styles.cardLeft}>
                <div className={styles.iconBox}>
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="12" cy="12" r="8" fill="#FFDF00" stroke="#D4AF37" strokeWidth="2" />
                    <path
                      d="M8 18 L6 24 L10 21 L12 24 L14 21 L18 24 L16 18 Z"
                      fill="#FFDF00"
                      stroke="#D4AF37"
                      strokeWidth="1"
                    />
                    <path
                      d="M12 8 L13.5 11 L17 11.5 L14.5 14 L15 17 L12 15.5 L9 17 L9.5 14 L7 11.5 L10.5 11 Z"
                      fill="#fff"
                    />
                  </svg>
                </div>
                <div className={styles.cardInfo}>
                  <h3 className={styles.courseTitle}>{cert.course.title}</h3>
                  <span className={styles.certId}>
                    Certificate ID: #{cert.id.substring(0, 8).toUpperCase()}
                  </span>
                </div>
              </div>
              <div className={styles.cardRight}>
                <div className={styles.dateTime}>
                  <span className={styles.date}>{formatIssueDate(cert.issuedAt)}</span>
                  <span className={styles.time}>{formatIssueTime(cert.issuedAt)}</span>
                </div>
                <div className={styles.badge}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  Approved
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedCertId && (
        <CertificateModal
          isOpen={true}
          onClose={() => setSelectedCertId(null)}
          certificateId={selectedCertId}
        />
      )}
    </div>
  );
}
