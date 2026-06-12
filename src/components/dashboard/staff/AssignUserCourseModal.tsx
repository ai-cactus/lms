'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { getCourses } from '@/app/actions/course';
import { enrollUsers } from '@/app/actions/enrollment';
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
      if (userEmail) {
        setEmails([userEmail]);
      } else {
        setEmails([]);
      }
      setInputValue('');
    }
  }, [isOpen, userEmail, fetchCourses]);

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
      const res = await enrollUsers(
        selectedCourseId,
        finalEmails.map((email) => ({ email })),
      );
      setResult(res);

      // If completely successful or already enrolled, close after a delay
      if (res.success.length > 0 || res.alreadyEnrolled.length > 0) {
        if (onSuccess) onSuccess();
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (error) {
      logger.error({ msg: 'Failed to assign course:', err: error });
      setResult({ success: [], alreadyEnrolled: [], failed: finalEmails });
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
          <div>
            <label className="mb-2 block text-sm font-medium text-text-secondary">
              Email Addresses
            </label>
            <div
              className="flex min-h-11 cursor-text flex-wrap items-center gap-2 rounded-md border-2 border-border bg-background p-2 transition-colors focus-within:border-primary"
              onClick={() => document.getElementById('assign-email-chip-input')?.focus()}
            >
              {emails.map((email) => (
                <div
                  key={email}
                  className="flex items-center rounded-2xl bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                >
                  {email}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeEmail(email);
                    }}
                    className="ml-1.5 flex items-center text-primary"
                  >
                    <X className="size-3.5" aria-hidden="true" />
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
                className="min-w-[120px] flex-1 border-none bg-transparent text-sm text-foreground outline-none"
              />
            </div>
            <p className="mt-1 text-xs text-text-tertiary">
              Press Space, Enter or Comma to add an email.
            </p>
          </div>

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

        {/* Result feedback */}
        {result && (
          <div className="mb-4 flex flex-col gap-2">
            {result.success.length > 0 && (
              <Alert variant="success">Successfully assigned course</Alert>
            )}
            {result.alreadyEnrolled?.length > 0 && (
              <Alert variant="warning">User is already enrolled in this course</Alert>
            )}
            {result.failed?.length > 0 && <Alert variant="error">Failed to assign course</Alert>}
          </div>
        )}

        <DialogFooter>
          <Button
            className="w-full"
            onClick={handleAssign}
            disabled={
              !selectedCourseId ||
              isLoading ||
              isFetching ||
              (emails.length === 0 && !inputValue.trim())
            }
            loading={isLoading}
          >
            {isLoading ? 'Assigning...' : 'Assign Course'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
