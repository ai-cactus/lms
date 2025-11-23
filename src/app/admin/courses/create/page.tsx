"use client";

import { Suspense } from "react";
import { WizardContainer } from "@/components/wizard/wizard-container";
import { useRouter, useSearchParams } from "next/navigation";
import { CourseData } from "@/types/course";

function CreateCourseContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const policyId = searchParams.get("policyId");

    const handleClose = () => {
        router.push("/admin/training-center");
    };

    const handleComplete = async (data: CourseData, files: File[]) => {
        // In a real app, we would submit data here
        console.log("Course created:", data, files);
        router.push("/admin/training-center");
    };

    return (
        <WizardContainer
            onClose={handleClose}
            onComplete={handleComplete}
            initialPolicyId={policyId || undefined}
        />
    );
}

export default function CreateCoursePage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <CreateCourseContent />
        </Suspense>
    );
}
