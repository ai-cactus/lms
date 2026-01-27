"use client";

import { Suspense, useEffect, useState } from "react";
import { WizardContainer } from "@/components/wizard/wizard-container";
import { useRouter, useSearchParams } from "next/navigation";
import { CourseData } from "@/types/course";
import { createClient } from "@/lib/supabase/client";
import { courseDraftManager, CourseDraft } from "@/lib/course-draft";

interface InputQuizQuestion {
    questionText: string;
    options: string[];
    correctAnswer: number;
    explanation?: string;
}

function CreateCourseContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const policyId = searchParams.get("policyId");
    const policyIds = searchParams.get("policyIds");
    const draftId = searchParams.get("draftId");
    const newDraft = searchParams.get("newDraft") === "true";
    const resumeStep = searchParams.get("resumeStep");
    const [loadingDraft, setLoadingDraft] = useState(!!draftId);
    const [draftData, setDraftData] = useState<CourseDraft | null>(null);
    const supabase = createClient();

    useEffect(() => {
        if (draftId) {
            loadDraftById(draftId);
        }
    }, [draftId]);

    // ... (rest of loadDraftById)

    const loadDraftById = async (id: string) => {
        try {
            setLoadingDraft(true);
            const { data: draft, error } = await supabase
                .from('course_drafts')
                .select('*')
                .eq('id', id)
                .single();

            if (error || !draft) {
                console.error('Error loading draft:', error);
                router.push('/admin/courses/create'); // Redirect to clean create page
                return;
            }

            setDraftData(draft);
            courseDraftManager.setCurrentDraftId(draft.id);
        } catch (error) {
            console.error('Error loading draft:', error);
            router.push('/admin/courses/create');
        } finally {
            setLoadingDraft(false);
        }
    };

    const handleClose = () => {
        router.push("/admin/courses");
    };

    const handleDraftReady = (id: string, title: string) => {
        // Redirect to courses list with success banner info
        const params = new URLSearchParams();
        params.set("course_ready", "true");
        params.set("title", title);
        params.set("draftId", id);
        router.push(`/admin/courses?${params.toString()}`);
    };

    const handleComplete = async (data: CourseData, files: File[], publishOptions?: {
        assignType: "specific" | "all";
        selectedUserIds: string[];
        emailInvites: string[];
        deadline?: {
            enabled: boolean;
            dueDate: string;
            dueTime: string;
            reminders: number[];
        };
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

            // Calculate deadline Date object
            let deadlineDate: Date | null = null;
            if (publishOptions?.deadline?.enabled && publishOptions.deadline.dueDate) {
                const dateStr = publishOptions.deadline.dueDate;
                const timeStr = publishOptions.deadline.dueTime || "23:59";
                deadlineDate = new Date(`${dateStr}T${timeStr}`);
            } else {
                // Default 30 days if not specified but maybe we shouldn't set one if not enabled? 
                // Legacy logic set it to 30 days. Let's keep it null if not enabled, or 30 days if "All Personnel" without specific deadline.
                // Actually user can toggle it. If disabled, let's set it to null or far future. 
                // Let's set it to null (no deadline) if disabled.
                // Check if DB supports null deadline. Usually yes.
            }

            // 3. Insert Course
            let lessonNotes = "";
            if (data.description) lessonNotes += `## Course Description\n${data.description}\n\n`;
            if (data.objectives?.some(obj => obj.trim())) {
                lessonNotes += `## What You'll Learn\n\n`;
                data.objectives.forEach((obj, index) => {
                    if (obj.trim()) lessonNotes += `${index + 1}. ${obj}\n`;
                });
                lessonNotes += `\n`;
            }
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

            if (courseError) throw courseError;

            // 4. Insert Quiz Questions
            if (data.questions && data.questions.length > 0) {
                const questionsToInsert = data.questions.map((q: InputQuizQuestion) => ({
                    course_id: course.id,
                    question_text: q.questionText,
                    options: q.options,
                    correct_answer: q.options[q.correctAnswer],
                    question_type: "multiple_choice",
                    explanation: q.explanation
                }));

                const { error: quizError } = await supabase
                    .from("quiz_questions")
                    .insert(questionsToInsert);

                if (quizError) throw quizError;
            }

            // 5. Handle Assignments
            let userIdsToAssign: string[] = [];

            if (publishOptions?.assignType === "all") {
                // Fetch all users
                const { data: orgUsers } = await supabase
                    .from("users")
                    .select("id")
                    .eq("organization_id", userData.organization_id)
                    .neq("role", "admin");

                if (orgUsers) {
                    userIdsToAssign = orgUsers.map(u => u.id);
                }
            } else if (publishOptions?.assignType === "specific" && publishOptions.selectedUserIds) {
                userIdsToAssign = publishOptions.selectedUserIds;
            }

            if (userIdsToAssign.length > 0) {
                const assignments = userIdsToAssign.map(workerId => ({
                    course_id: course.id,
                    worker_id: workerId,
                    assigned_by: user.id,
                    status: "not_started",
                    assigned_at: new Date().toISOString(),
                    deadline: deadlineDate ? deadlineDate.toISOString() : undefined // Pass undefined if no deadline
                }));

                const { error: assignmentError } = await supabase
                    .from("course_assignments")
                    .insert(assignments);

                if (assignmentError) {
                    console.error("Assignment error:", assignmentError);
                    alert("Course created but failed to assign some users.");
                }
            }

            // Handle Email Invites
            if (publishOptions?.emailInvites && publishOptions.emailInvites.length > 0) {
                // Get inviter name
                const { data: inviterProfile } = await supabase
                    .from("users")
                    .select("first_name, last_name")
                    .eq("id", user.id)
                    .single();

                const inviterName = inviterProfile
                    ? `${inviterProfile.first_name || ''} ${inviterProfile.last_name || ''}`.trim()
                    : "Theraptly Admin";

                const formattedDeadline = deadlineDate
                    ? deadlineDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : undefined;

                // Send emails in background (don't block redirect ideally, but for now we await to ensure success logging)
                // We'll use Promise.allSettled to ensure individual failures don't crash the whole flow
                await Promise.allSettled(publishOptions.emailInvites.map(email =>
                    fetch("/api/send-invite", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email,
                            courseTitle: data.title,
                            inviterName,
                            courseId: course.id,
                            deadline: formattedDeadline
                        })
                    })
                ));
            }

            // 6. Redirect
            router.push("/admin/courses");

        } catch (error: any) {
            console.error("Error saving course:", error);
            alert(`Failed to save course: ${error.message || "Unknown error"}`);
        }
    };

    const initialPolicyIds = policyIds
        ? policyIds.split(',')
        : policyId
            ? [policyId]
            : undefined;

    if (loadingDraft) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4E61F6] mx-auto mb-4"></div>
                    <p className="text-slate-600">Loading draft...</p>
                </div>
            </div>
        );
    }

    return (
        <WizardContainer
            onClose={handleClose}
            onComplete={handleComplete}
            onDraftReady={handleDraftReady}
            initialPolicyIds={initialPolicyIds}
            initialDraft={draftData ?? undefined}
            forceNewDraft={newDraft}
            initialStep={resumeStep ? parseInt(resumeStep) : undefined}
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
