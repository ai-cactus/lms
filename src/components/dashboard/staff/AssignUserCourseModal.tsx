'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Button } from '@/components/ui';
import { getCourses } from '@/app/actions/course';
import { enrollUsers } from '@/app/actions/enrollment';
import styles from './AssignUserCourseModal.module.css';

interface AssignUserCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  userName: string;
  enrolledCourseIds: string[];
  onSuccess?: () => void;
}

export default function AssignUserCourseModal({
  isOpen,
  onClose,
  userEmail,
  userName,
  enrolledCourseIds,
  onSuccess,
}: AssignUserCourseModalProps) {
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [emails, setEmails] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [result, setResult] = useState<{
    success: string[];
    alreadyEnrolled: string[];
    failed: string[];
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchCourses();
      setResult(null);
      setSelectedCourseId('');
      if (userEmail) {
        setEmails([userEmail]);
      } else {
        setEmails([]);
      }
      setInputValue('');
    }
  }, [isOpen, userEmail]);

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ' ', ','].includes(e.key)) {
      e.preventDefault();
      const val = inputValue.trim();
      if (val && isValidEmail(val)) {
        if (!emails.includes(val)) {
          setEmails([...emails, val]);
        }
        setInputValue('');
      }
    } else if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter((email) => email !== emailToRemove));
  };

  const fetchCourses = async () => {
    setIsFetching(true);
    try {
      const data = await getCourses();
      // Filter out courses the user is already enrolled in
      const availableCourses = data.filter((course) => !enrolledCourseIds.includes(course.id));
      setCourses(availableCourses);
    } catch (error) {
      console.error('Failed to fetch courses:', error);
    } finally {
      setIsFetching(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedCourseId) return;

    const finalEmails = [...emails];
    const currentVal = inputValue.trim();
    if (currentVal && isValidEmail(currentVal) && !finalEmails.includes(currentVal)) {
      finalEmails.push(currentVal);
      setEmails(finalEmails);
      setInputValue('');
    }

    if (finalEmails.length === 0) return;

    setIsLoading(true);
    setResult(null);

    try {
      const res = await enrollUsers(selectedCourseId, finalEmails);
      setResult(res);

      // If completely successful or already enrolled, close after a delay
      if (res.success.length > 0 || res.alreadyEnrolled.length > 0) {
        if (onSuccess) onSuccess();
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (error) {
      console.error('Failed to assign course:', error);
      setResult({ success: [], alreadyEnrolled: [], failed: finalEmails });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={userName ? `Assign Course to ${userName}` : "Assign Course"}
      description={`Select a course to assign.`}
    >
      <div className={styles.inputGroup}>
        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: 500,
              color: '#4A5568',
            }}
          >
            Email Addresses
          </label>
          <div
            style={{
              border: '2px solid #E2E8F0',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              minHeight: '44px',
              alignItems: 'center',
              background: 'white',
              cursor: 'text',
              transition: 'border-color 0.2s',
            }}
            onClick={() => document.getElementById('assign-email-chip-input')?.focus()}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#4c6ef5')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#E2E8F0')}
          >
            {emails.map((email) => (
              <div
                key={email}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#EBF8FF',
                  color: '#2C5282',
                  borderRadius: '16px',
                  padding: '4px 12px',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                {email}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeEmail(email);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    marginLeft: '6px',
                    cursor: 'pointer',
                    color: '#2C5282',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                  }}
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
                </button>
              </div>
            ))}
            <input
              id="assign-email-chip-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={emails.length === 0 ? 'Enter emails...' : ''}
              style={{
                border: 'none',
                outline: 'none',
                flex: 1,
                fontSize: '14px',
                minWidth: '120px',
                color: '#2D3748',
                background: 'transparent',
              }}
            />
          </div>
          <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
            Press Space, Enter or Comma to add an email.
          </p>
        </div>

        <div className={styles.selectWrapper}>
          <select
            className={`${styles.select} ${selectedCourseId ? styles.hasSelection : ''}`}
            value={selectedCourseId}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            disabled={isLoading || isFetching || courses.length === 0}
          >
            <option value="" disabled>
              {isFetching
                ? 'Loading courses...'
                : courses.length === 0
                  ? 'User has been assigned all available courses'
                  : 'Select a course...'}
            </option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
          <div className={styles.chevron}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>

        <Button
          onClick={handleAssign}
          disabled={!selectedCourseId || isLoading || isFetching || (emails.length === 0 && !inputValue.trim())}
          loading={isLoading}
          className={styles.assignButton}
        >
          {isLoading ? 'Assigning...' : 'Assign Course'}
        </Button>
      </div>

      {/* Result feedback */}
      {result && (
        <div className={styles.resultSection}>
          {result.success.length > 0 && (
            <div className={styles.resultSuccess}>✓ Successfully assigned course</div>
          )}
          {result.alreadyEnrolled?.length > 0 && (
            <div className={styles.resultWarning}>User is already enrolled in this course</div>
          )}
          {result.failed?.length > 0 && (
            <div className={styles.resultError}>Failed to assign course</div>
          )}
        </div>
      )}
    </Modal>
  );
}
