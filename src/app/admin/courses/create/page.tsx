"use client";

import { Suspense } from "react";
import { WizardContainer } from "@/components/wizard/wizard-container";
import { useRouter, useSearchParams } from "next/navigation";
import { CourseData } from "@/types/course";
import { createClient } from "@/lib/supabase/client";

function CreateCourseContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const policyId = searchParams.get("policyId");
    const policyIds = searchParams.get("policyIds");
    const supabase = createClient();

    const handleClose = () => {
        router.push("/admin/training-center");
    };

    const handleComplete = async (data: CourseData, files: File[], publishOptions?: {
        deadline?: { dueDate: string; dueTime: string };
        assignType: string;
        selectedRoles?: string[];
        emails?: string[];
    }) => {
        try {
            // 1. Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("User not authenticated");

            // 2. Get user's organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData?.organization_id) throw new Error("Organization not found");

            // Calculate deadline_days if deadline is provided
            let deadlineDays = 30; // Default
            if (publishOptions?.deadline?.dueDate) {
                const start = new Date();
                const end = new Date(publishOptions.deadline.dueDate);
                const diffTime = Math.abs(end.getTime() - start.getTime());
                deadlineDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }

            // 3. Insert Course
            // Build lesson_notes with description, objectives, and generated content
            let lessonNotes = "";

            // Add description if provided
            if (data.description) {
                lessonNotes += `## Course Description\n${data.description}\n\n`;
            }

            // Add objectives if provided
            if (data.objectives && data.objectives.some(obj => obj.trim())) {
                lessonNotes += `## What You'll Learn\n\n`;
                data.objectives.forEach((obj, index) => {
                    if (obj.trim()) {
                        lessonNotes += `${index + 1}. ${obj}\n`;
                    }
                });
                lessonNotes += `\n`;
            }

            // Add generated content
            lessonNotes += data.generatedContent || "";

            const { data: course, error: courseError } = await supabase
                .from("courses")
                .insert({
                    title: data.title,
                    lesson_notes: lessonNotes,
                    objectives: {
                        items: data.objectives || [],
                        difficulty: data.difficulty || "Beginner"
                    },
                    pass_mark: parseInt(data.quizConfig?.passMark || "80"),
                    attempts_allowed: data.quizConfig?.attempts || 3,
                    organization_id: userData.organization_id,
                    published_at: new Date().toISOString()
                })
                .select()
                .single();

            if (courseError) {
                console.error("Course insert error:", courseError);
                throw courseError;
            }

            // 4. Insert Quiz Questions
            if (data.questions && data.questions.length > 0) {
                const questionsToInsert = data.questions.map((q: any) => ({
                    course_id: course.id,
                    question_text: q.text,
                    options: q.options,
                    correct_answer: q.options[q.correctAnswer],
                    question_type: "multiple_choice"
                }));

                const { error: quizError } = await supabase
                    .from("quiz_questions")
                    .insert(questionsToInsert);

                if (quizError) {
                    console.error("Quiz insert error:", quizError);
                    throw quizError;
                }
            }

            // 5. Handle Assignments
            if (publishOptions?.assignType === "All Personnel") {
                // Fetch all users in the organization, excluding admins
                const { data: orgUsers, error: usersError } = await supabase
                    .from("users")
                    .select("id")
                    .eq("organization_id", userData.organization_id)
                    .neq("role", "admin");  // Exclude admin users

                if (usersError) {
                    console.error("Error fetching users for assignment:", usersError);
                } else if (orgUsers && orgUsers.length > 0) {
                    // Calculate deadline based on deadline_days
                    const deadlineDate = new Date();
                    deadlineDate.setDate(deadlineDate.getDate() + deadlineDays);

                    const assignments = orgUsers.map(u => ({
                        course_id: course.id,
                        worker_id: u.id,
                        assigned_by: user.id,
                        status: "not_started",
                        assigned_at: new Date().toISOString(),
                        deadline: deadlineDate.toISOString()
                    }));

                    const { error: assignmentError } = await supabase
                        .from("course_assignments")
                        .insert(assignments);

                    if (assignmentError) {
                        console.error("Error creating assignments:", assignmentError);
                        console.error("Assignment error details:", JSON.stringify(assignmentError, null, 2));
                        // Don't throw here, as the course is already created. Just log it.
                        alert("Course created, but failed to assign users. Please try assigning manually.");
                    }
                }
            }

            // 5. Redirect
            router.push("/admin/training-center");

        } catch (error: any) {
            console.error("Error saving course:", error);
            console.error("Error details:", JSON.stringify(error, null, 2));
            alert(`Failed to save course: ${error.message || "Unknown error"}`);
        }
    };

    // Parse policyIds if present, otherwise use single policyId
    const initialPolicyIds = policyIds
        ? policyIds.split(',')
        : policyId
            ? [policyId]
            : undefined;

    return (
        <WizardContainer
            onClose={handleClose}
            onComplete={handleComplete}
            initialPolicyIds={initialPolicyIds}
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
