'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Button } from '@/components/ui';
import ShareCourseModal from '../training/ShareCourseModal';

interface CourseSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
}

export default function CourseSuccessModal({ isOpen, onClose, courseId }: CourseSuccessModalProps) {
  const router = useRouter();
  const [showShareModal, setShowShareModal] = React.useState(false);

  const handleFinish = () => {
    onClose();
    router.push('/dashboard/training');
  };

  if (showShareModal) {
    return <ShareCourseModal isOpen={true} onClose={handleFinish} courseId={courseId} />;
  }

  return (
    <Modal isOpen={isOpen} onClose={handleFinish} size="md">
      <div className="text-center p-6">
        <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-6">
          <svg
            className="h-8 w-8 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-2">Course Created Successfully!</h2>
        <p className="text-gray-600 mb-8">
          Your new course has been published and is ready for learners.
        </p>

        <div className="flex flex-col gap-3">
          <Button variant="primary" fullWidth onClick={() => setShowShareModal(true)}>
            Assign to Workers
          </Button>
          <Button variant="outline" fullWidth onClick={handleFinish}>
            Go to Training Dashboard
          </Button>
        </div>
      </div>
    </Modal>
  );
}
