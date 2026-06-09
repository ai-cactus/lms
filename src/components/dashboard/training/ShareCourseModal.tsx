'use client';

import React from 'react';
import styles from './ShareCourseModal.module.css';
import { enrollUsers } from '@/app/actions/enrollment';
import { Modal, Button } from '@/components/ui';
import { logger } from '@/lib/logger';
import type { StaffEntry } from '@/types/enrollment';

interface ShareCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
}

export default function ShareCourseModal({ isOpen, onClose, courseId }: ShareCourseModalProps) {
  const [entries, setEntries] = React.useState<StaffEntry[]>([]);
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
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) return;

      // Detect whether the first row is a header by checking if the last
      // column of the first row contains a valid email address.
      const firstRowCells = lines[0].split(',').map((c) => c.trim());
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const hasHeader = !emailRegex.test(firstRowCells[firstRowCells.length - 1]);
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const existingEmails = new Set(entries.map((en) => en.email.toLowerCase()));
      const newEntries: StaffEntry[] = [];

      dataLines.forEach((line) => {
        const cells = line.split(',').map((c) => c.trim());

        // Support both old single-column (email only) and new four-column format.
        // New format: First Name, Last Name, Role, Email
        let firstName: string | undefined;
        let lastName: string | undefined;
        let role: 'admin' | 'worker' | undefined;
        let email: string;

        if (cells.length >= 4) {
          firstName = cells[0] || undefined;
          lastName = cells[1] || undefined;
          const rawRole = cells[2].toLowerCase();
          role = rawRole === 'admin' ? 'admin' : 'worker';
          email = cells[3];
        } else {
          // Fallback: scan all cells for the first valid email.
          email = cells.find((c) => emailRegex.test(c)) ?? '';
        }

        if (!email || !emailRegex.test(email)) return;

        const normalizedEmail = email.toLowerCase();
        if (existingEmails.has(normalizedEmail)) return;

        existingEmails.add(normalizedEmail);
        newEntries.push({ email: normalizedEmail, firstName, lastName, role });
      });

      if (newEntries.length > 0) {
        setEntries((prev) => [...prev, ...newEntries]);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const downloadTemplate = () => {
    const rows = [
      'First Name,Last Name,Role,Email',
      'Jane,Doe,worker,jane.doe@example.com',
      'John,Smith,worker,john.smith@example.com',
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'assign_staff_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', 'Tab', ',', ' '].includes(e.key)) {
      e.preventDefault();
      const email = inputValue.trim().toLowerCase();
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (!entries.some((en) => en.email === email)) {
          setEntries((prev) => [...prev, { email }]);
        }
        setInputValue('');
      }
    } else if (e.key === 'Backspace' && !inputValue && entries.length > 0) {
      setEntries((prev) => prev.slice(0, -1));
    }
  };

  const removeEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleShare = async () => {
    if (entries.length === 0) return;

    setIsLoading(true);
    setResult(null);

    try {
      const res = await enrollUsers(courseId, entries);
      setResult(res);

      // Remove successfully processed entries from the chip list.
      const processedEmails = new Set([...res.success, ...res.newInvited]);
      if (processedEmails.size > 0) {
        setEntries((prev) => prev.filter((en) => !processedEmails.has(en.email)));
      }

      // Auto-close if all entries were successfully handled.
      if (res.success.length + res.newInvited.length === entries.length) {
        setTimeout(() => {
          onClose();
          setEntries([]);
          setResult(null);
        }, 1500);
      }
    } catch (error) {
      logger.error({ msg: '[share-course] Failed to enroll users', err: error });
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

          {entries.map((entry, index) => (
            <span
              key={index}
              className={styles.chip}
              title={
                entry.firstName ? `${entry.firstName} ${entry.lastName ?? ''}`.trim() : entry.email
              }
            >
              {entry.email}
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.removeChip}
                onClick={() => removeEntry(index)}
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
            placeholder={entries.length === 0 ? 'Emails, comma separated' : ''}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
        </div>
        <Button
          variant="primary"
          className={`${styles.shareButton} ${entries.length > 0 ? styles.shareButtonActive : ''}`}
          onClick={handleShare}
          disabled={entries.length === 0 || isLoading}
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
