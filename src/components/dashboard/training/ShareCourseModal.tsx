'use client';

import React from 'react';
import styles from './ShareCourseModal.module.css';
import { enrollUsers } from '@/app/actions/enrollment';
import { Modal, Button } from '@/components/ui';
import { logger } from '@/lib/logger';

interface ShareCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
}

export default function ShareCourseModal({ isOpen, onClose, courseId }: ShareCourseModalProps) {
  const [emails, setEmails] = React.useState<string[]>([]);
  const [inputValue, setInputValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [hasDeadline, setHasDeadline] = React.useState(false);
  const [deadlineDate, setDeadlineDate] = React.useState('');
  const [result, setResult] = React.useState<{
    success: string[];
    alreadyEnrolled: string[];
    newInvited: string[];
    failed: string[];
  } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const newEmails: string[] = [];
      lines.forEach((line) => {
        const parts = line.split(',');
        parts.forEach((part) => {
          const email = part.trim();
          if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            newEmails.push(email);
          }
        });
      });

      const uniqueNew = newEmails.filter((e) => !emails.includes(e));
      if (uniqueNew.length > 0) {
        setEmails([...emails, ...uniqueNew]);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const downloadTemplate = () => {
    const csvContent = 'data:text/csv;charset=utf-8,Email\nuser1@example.com\nuser2@example.com';
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'assign_staff_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', 'Tab', ',', ' '].includes(e.key)) {
      e.preventDefault();
      const email = inputValue.trim();
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (!emails.includes(email)) {
          setEmails([...emails, email]);
        }
        setInputValue('');
      }
    } else if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  };

  const removeEmail = (index: number) => {
    setEmails(emails.filter((_, i) => i !== index));
  };

  const handleShare = async () => {
    if (emails.length === 0) return;

    setIsLoading(true);
    setResult(null);

    try {
      const res = await enrollUsers(courseId, emails);
      setResult(res);

      // Clear successfully enrolled emails
      if (res.success.length > 0) {
        const remainingEmails = emails.filter((e) => !res.success.includes(e));
        setEmails(remainingEmails);
      }

      // Auto-close if all successful or invited
      if (res.success.length + res.newInvited.length === emails.length) {
        setTimeout(() => {
          onClose();
          setEmails([]);
          setResult(null);
        }, 1500);
      }
    } catch (error) {
      logger.error({ msg: 'Failed to enroll users:', err: error });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title="Assign this course"
      description="Enter one or more emails to invite to your course."
    >
      <div className={styles.inputGroup}>
        <div
          className={styles.inputWrapper}
          onClick={() => document.getElementById('email-input')?.focus()}
        >
          <svg
            className={styles.inputIcon}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>

          {emails.map((email, index) => (
            <span key={index} className={styles.chip}>
              {email}
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.removeChip}
                onClick={() => removeEmail(index)}
              >
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
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </Button>
            </span>
          ))}

          <input
            id="email-input"
            className={styles.input}
            placeholder={emails.length === 0 ? 'Emails, comma separated' : ''}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
        </div>
        <Button
          variant="primary"
          className={`${styles.shareButton} ${emails.length > 0 ? styles.shareButtonActive : ''}`}
          onClick={handleShare}
          disabled={emails.length === 0 || isLoading}
        >
          {isLoading ? 'Assigning...' : 'Assign'}
        </Button>
      </div>

      <div className={styles.csvLinks}>
        <label className={styles.csvLink}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: 6 }}
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="16"></line>
            <line x1="8" y1="12" x2="16" y2="12"></line>
          </svg>
          Click to upload .csv file instead
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </label>
        <button className={styles.csvLink} onClick={downloadTemplate}>
          Download sample .csv template
        </button>
      </div>

      <div className={styles.toggleRow}>
        <div className={styles.labelGroup}>
          <span className={styles.labelTitle}>Set Completion Deadline</span>
          <span className={styles.labelDesc}>
            Set a deadline for team member to complete this course
          </span>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={hasDeadline}
            onChange={(e) => setHasDeadline(e.target.checked)}
          />
          <span className={styles.slider}></span>
        </label>
      </div>

      {hasDeadline && (
        <div className={styles.datePickerContainer}>
          <div className={styles.dateInputWrapper}>
            <svg
              className={styles.dateIcon}
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <input
              type="date"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              className={styles.dateInput}
            />
          </div>
        </div>
      )}

      {/* Result feedback */}
      {result && (
        <div className={styles.resultSection}>
          {result.success.length > 0 && (
            <div className={styles.resultSuccess}>✓ Enrolled: {result.success.join(', ')}</div>
          )}
          {result.newInvited.length > 0 && (
            <div className={styles.resultInvited}>
              📧 Invited & Enrolled: {result.newInvited.join(', ')}
            </div>
          )}
          {result.alreadyEnrolled.length > 0 && (
            <div className={styles.resultWarning}>
              Already enrolled: {result.alreadyEnrolled.join(', ')}
            </div>
          )}
          {result.failed.length > 0 && (
            <div className={styles.resultError}>Failed: {result.failed.join(', ')}</div>
          )}
        </div>
      )}
    </Modal>
  );
}
