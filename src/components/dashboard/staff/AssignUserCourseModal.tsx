'use client';

import React, { useState, useEffect } from 'react';
import { getCourses } from '@/app/actions/course';
import { assignCourseToStaffMember } from '@/app/actions/staff';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { logger } from '@/lib/logger';

interface AssignUserCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffUserId: string;
  userName: string;
  enrolledCourseIds: string[];
  onSuccess?: () => void;
}

export default function AssignUserCourseModal({
  isOpen,
  onClose,
  staffUserId,
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
    error?: string;
  } | null>(null);

  const fetchCourses = React.useCallback(async () => {
    setIsFetching(true);
    try {
      const data = await getCourses();
      // Filter out courses the user is already enrolled in
      const availableCourses = data.filter((course) => !enrolledCourseIds.includes(course.id));
      setCourses(availableCourses);
    } catch (error) {
      logger.error({ msg: 'Failed to fetch courses:', err: error });
    } finally {
      setIsFetching(false);
    }
  }, [enrolledCourseIds]);

  useEffect(() => {
    if (isOpen) {
      fetchCourses();
      setResult(null);
      setSelectedCourseId('');
    }
  }, [isOpen, fetchCourses]);

  const handleAssign = async () => {
    if (!selectedCourseId) return;

    setIsLoading(true);
    setResult(null);

    try {
      const res = await assignCourseToStaffMember(selectedCourseId, staffUserId);
      setResult({
        success: res.success,
        alreadyEnrolled: res.alreadyEnrolled,
        failed: res.failed,
        error: res.error,
      });

      // Close after a short delay only when the assignment actually landed.
      if (res.success.length > 0 || res.alreadyEnrolled.length > 0) {
        if (onSuccess) onSuccess();
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (error) {
      logger.error({ msg: 'Failed to assign course:', err: error });
      setResult({ success: [], alreadyEnrolled: [], failed: [staffUserId] });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{userName ? `Assign Course to ${userName}` : 'Assign Course'}</DialogTitle>
          <DialogDescription>Select a course to assign.</DialogDescription>
        </DialogHeader>

        <div className="mb-6 flex flex-col gap-4">
          <Select
            value={selectedCourseId}
            onValueChange={(value) => setSelectedCourseId(value)}
            disabled={isLoading || isFetching || courses.length === 0}
          >
            <SelectTrigger className="h-11 w-full">
              <SelectValue
                placeholder={
                  isFetching
                    ? 'Loading courses...'
                    : courses.length === 0
                      ? 'User has been assigned all available courses'
                      : 'Select a course...'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {courses.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {result && (
          <div className="mb-4 flex flex-col gap-2">
            {result.error && <Alert variant="error">{result.error}</Alert>}
            {result.success.length > 0 && (
              <Alert variant="success">Successfully assigned course</Alert>
            )}
            {result.alreadyEnrolled?.length > 0 && (
              <Alert variant="warning">User is already enrolled in this course</Alert>
            )}
            {!result.error && result.failed?.length > 0 && (
              <Alert variant="error">Failed to assign course</Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            className="w-full"
            onClick={handleAssign}
            disabled={!selectedCourseId || isLoading || isFetching}
            loading={isLoading}
          >
            {isLoading ? 'Assigning...' : 'Assign Course'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
