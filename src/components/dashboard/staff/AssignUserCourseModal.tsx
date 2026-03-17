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
    }
  }, [isOpen]);

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

    setIsLoading(true);
    setResult(null);

    try {
      const res = await enrollUsers(selectedCourseId, [userEmail]);
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
      setResult({ success: [], alreadyEnrolled: [], failed: [userEmail] });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={`Assign Course to ${userName}`}
      description={`Select a course to assign to ${userEmail}.`}
    >
      <div className={styles.inputGroup}>
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
          disabled={!selectedCourseId || isLoading || isFetching}
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
