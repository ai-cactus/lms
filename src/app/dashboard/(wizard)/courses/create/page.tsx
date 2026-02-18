import { Suspense } from 'react';
import CourseWizard from '@/components/dashboard/courses/CourseWizard';

export default function CreateCoursePage() {
    return (
        <Suspense fallback={<div>Loading course wizard...</div>}>
            <CourseWizard />
        </Suspense>
    );
}
