'use client';

import React, { useEffect, useState } from 'react';
import styles from './CertificateModal.module.css';
import { Button } from '@/components/ui';
import { getCertificateDetails } from '@/app/actions/certificate';

type CertificateData = Awaited<ReturnType<typeof getCertificateDetails>>;

interface CertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificateId: string;
}

export default function CertificateModal({
  isOpen,
  onClose,
  certificateId,
}: CertificateModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CertificateData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !certificateId) return;

    let cancelled = false;

    getCertificateDetails(certificateId)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, certificateId]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Certificate Details</h2>
          <div className={styles.headerActions}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`/api/certificates/${certificateId}`, '_blank')}
            >
              Export
            </Button>
            <button className={styles.closeButton} onClick={onClose}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading certificate...</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : (
          <div className={styles.certificateWrapper}>
            <div className={styles.certificate}>
              {/* Watermark */}
              <div className={styles.watermark}>Theraptly</div>

              {/* Logo Top Right */}
              <div className={styles.logoContainer}>
                <h1 className={styles.logoText}>Theraptly</h1>
              </div>

              {/* Top Banner/Border */}
              <div className={styles.topBorder}></div>

              {/* Content */}
              <div className={styles.content}>
                <h2 className={styles.title}>CERTIFICATE OF COMPLETION</h2>
                <p className={styles.subtitle}>This is to certify that</p>
                <h3 className={styles.studentName}>
                  {data?.user?.profile?.fullName || data?.user?.email || 'Student Name'}
                </h3>
                <p className={styles.description}>
                  successfully completed and received a passing grade in
                </p>
                <h4 className={styles.courseName}>{data?.course?.title || 'Course Title'}</h4>
                <p className={styles.organizationText}>
                  a course of study offered by{' '}
                  <strong>{data?.user?.organization?.name || 'the Organization'}</strong>,
                  showcasing your commitment to excellence, innovation, and teamwork.
                </p>
              </div>

              {/* Footer */}
              <div className={styles.footer}>
                <div className={styles.footerLeft}>
                  {/* QR Code Placeholder */}
                  <div className={styles.qrCode}>
                    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect width="100" height="100" fill="#fff" />
                      <rect x="10" y="10" width="30" height="30" stroke="#000" strokeWidth="5" />
                      <rect x="60" y="10" width="30" height="30" stroke="#000" strokeWidth="5" />
                      <rect x="10" y="60" width="30" height="30" stroke="#000" strokeWidth="5" />
                      <rect x="20" y="20" width="10" height="10" fill="#000" />
                      <rect x="70" y="20" width="10" height="10" fill="#000" />
                      <rect x="20" y="70" width="10" height="10" fill="#000" />
                      <rect x="50" y="50" width="40" height="40" fill="#000" />
                    </svg>
                  </div>
                  <div className={styles.issueDetails}>
                    <p>
                      PRESENTED ON:{' '}
                      {data
                        ? new Date(data.issuedAt).toLocaleDateString('en-US', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : ''}
                    </p>
                    <p>
                      VALID CERTIFICATE ID: CERT-{data?.enrollmentId?.substring(0, 8).toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className={styles.footerRight}>
                  {/* Signature */}
                  <div className={styles.signatureBox}>
                    <div className={styles.signatureLine}></div>
                    <p className={styles.signatureText}>CTO, THERAPTLY</p>
                  </div>
                  {/* Gold Seal Placeholder */}
                  <div className={styles.goldSeal}>
                    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="#D4AF37"
                        stroke="#B8860B"
                        strokeWidth="2"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="35"
                        fill="#FFDF00"
                        stroke="#D4AF37"
                        strokeWidth="1"
                      />
                      <path d="M30 70 L20 100 L40 85 Z" fill="#D4AF37" />
                      <path d="M70 70 L80 100 L60 85 Z" fill="#D4AF37" />
                      <text
                        x="50"
                        y="55"
                        fontSize="20"
                        textAnchor="middle"
                        fill="#fff"
                        fontWeight="bold"
                      >
                        T
                      </text>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
