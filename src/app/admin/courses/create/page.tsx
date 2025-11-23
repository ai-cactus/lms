"use client";

import { WizardContainer } from "@/components/wizard/wizard-container";
import { useRouter } from "next/navigation";
import { CourseData } from "@/types/course";

export default function CreateCoursePage() {
    const router = useRouter();

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
        />
    );
}
