'use server'

import { createClient } from '@/lib/supabase/server'

export interface LearningNeed {
    objectiveId: string
    objectiveText: string
    courseId: string
    courseTitle: string
    status: 'needs_support' | 'at_risk' | 'on_track'
    correctPercentage: number
    totalQuestions: number
    suggestedAction: string
}

export async function getWorkerLearningNeeds(workerId: string): Promise<{
    success: boolean
    needs?: LearningNeed[]
    error?: string
}> {
    try {
        const supabase = await createClient()

        // 1. Fetch all quiz answers for the worker with question and course details
        const { data: answers, error: _answersError } = await supabase
            .from('quiz_answers')
            .select(`
                is_correct,
                question:quiz_questions (
                    id,
                    objective_id,
                    course_id
                ),
                attempt:quiz_attempts (
                    course_id,
                    score,
                    passed,
                    attempt_number
                )
            `)
            .eq('attempt.worker_id', workerId) // This might not work directly if RLS prevents joining on attempt filter

        // Better to fetch attempts first then answers, or rely on RLS
        // Let's try a more direct query structure that Supabase supports well

        // Fetch all attempts for the worker
        const { data: attempts, error: attemptsError } = await supabase
            .from('quiz_attempts')
            .select(`
                id,
                course_id,
                score,
                passed,
                attempt_number,
                course:courses (
                    id,
                    title,
                    objectives,
                    pass_mark,
                    max_attempts
                )
            `)
            .eq('worker_id', workerId)

        if (attemptsError) throw attemptsError
        if (!attempts || attempts.length === 0) return { success: true, needs: [] }

        const attemptIds = attempts.map(a => a.id)

        // Fetch answers for these attempts
        const { data: allAnswers, error: allAnswersError } = await supabase
            .from('quiz_answers')
            .select(`
                is_correct,
                attempt_id,
                question:quiz_questions (
                    id,
                    objective_id
                )
            `)
            .in('attempt_id', attemptIds)

        if (allAnswersError) throw allAnswersError

        // Process data to calculate needs
        const needs: LearningNeed[] = []
        const courseStats = new Map<string, {
            course: any,
            attempts: any[],
            answers: any[]
        }>()

        // Group by course
        attempts.forEach(attempt => {
            if (!courseStats.has(attempt.course_id)) {
                courseStats.set(attempt.course_id, {
                    course: attempt.course,
                    attempts: [],
                    answers: []
                })
            }
            courseStats.get(attempt.course_id)?.attempts.push(attempt)
        })

        allAnswers?.forEach(answer => {
            const attempt = attempts.find(a => a.id === answer.attempt_id)
            if (attempt && courseStats.has(attempt.course_id)) {
                courseStats.get(attempt.course_id)?.answers.push(answer)
            }
        })

        // Analyze each course
        courseStats.forEach((stats, _courseId) => {
            const { course, attempts, answers } = stats
            const objectives = course.objectives || []

            // 1. Check "At Risk" status (Course Level)
            // If passed only on last attempt with borderline score
            const passedAttempts = attempts.filter(a => a.passed)
            const isPassed = passedAttempts.length > 0

            if (isPassed) {
                const lastAttempt = passedAttempts.sort((a, b) => b.attempt_number - a.attempt_number)[0]
                const maxAttempts = course.max_attempts || 999
                const passMark = course.pass_mark || 80

                // Logic: Passed on last allowed attempt AND score is exactly pass mark (borderline)
                const isLastAttempt = lastAttempt.attempt_number === maxAttempts
                const isBorderline = lastAttempt.score === passMark

                if (isLastAttempt && isBorderline) {
                    // Add a general course-level "At Risk" need
                    needs.push({
                        objectiveId: 'course-risk',
                        objectiveText: 'Overall Course Proficiency',
                        courseId: course.id,
                        courseTitle: course.title,
                        status: 'at_risk',
                        correctPercentage: lastAttempt.score,
                        totalQuestions: 0, // Not applicable
                        suggestedAction: 'Schedule supervision check-in'
                    })
                }
            }

            // 2. Check "Needs Support" status (Objective Level)
            // Group answers by objective
            const objectiveStats = new Map<string, { correct: number, total: number }>()

            answers.forEach(answer => {
                const objId = answer.question?.objective_id
                if (objId) {
                    if (!objectiveStats.has(objId)) {
                        objectiveStats.set(objId, { correct: 0, total: 0 })
                    }
                    const stat = objectiveStats.get(objId)!
                    stat.total++
                    if (answer.is_correct) stat.correct++
                }
            })

            // Calculate % for each objective
            objectives.forEach((obj: any) => {
                const stat = objectiveStats.get(obj.id)
                if (stat && stat.total > 0) {
                    const percentage = Math.round((stat.correct / stat.total) * 100)

                    if (percentage < 70) {
                        needs.push({
                            objectiveId: obj.id,
                            objectiveText: obj.text,
                            courseId: course.id,
                            courseTitle: course.title,
                            status: 'needs_support',
                            correctPercentage: percentage,
                            totalQuestions: stat.total,
                            suggestedAction: `Assign refresher for ${course.title}`
                        })
                    }
                }
            })
        })

        return { success: true, needs }

    } catch (err: any) {
        console.error('Error calculating learning needs:', err)
        return { success: false, error: err.message }
    }
}

export async function getOrgPerformanceOverview(organizationId: string): Promise<{
    success: boolean
    topStrugglingObjectives?: {
        objectiveText: string
        courseTitle: string
        incorrectPercentage: number
        totalAttempts: number
    }[]
    error?: string
}> {
    try {
        const supabase = await createClient()

        // Fetch all quiz answers for the organization
        // We need to join through attempts -> users -> organization_id
        const { data: answers, error: _error } = await supabase
            .from('quiz_answers')
            .select(`
                is_correct,
                question:quiz_questions (
                    id,
                    objective_id,
                    course_id
                ),
                attempt:quiz_attempts (
                    worker:users (
                        organization_id
                    )
                )
            `)
            // We can't filter deep relations easily in one go with Supabase sometimes
            // But let's try filtering by the user's org
            .eq('attempt.worker.organization_id', organizationId)

        // If the deep filter fails, we might need a different approach:
        // 1. Get all users in org
        // 2. Get all attempts for those users
        // 3. Get answers for those attempts

        // Let's try the multi-step approach for reliability
        const { data: users } = await supabase
            .from('users')
            .select('id')
            .eq('organization_id', organizationId)

        if (!users?.length) return { success: true, topStrugglingObjectives: [] }

        const userIds = users.map(u => u.id)

        const { data: attempts } = await supabase
            .from('quiz_attempts')
            .select('id, course_id, course:courses(title, objectives)')
            .in('worker_id', userIds)

        if (!attempts?.length) return { success: true, topStrugglingObjectives: [] }

        const attemptIds = attempts.map(a => a.id)

        const { data: orgAnswers } = await supabase
            .from('quiz_answers')
            .select(`
                is_correct,
                attempt_id,
                question:quiz_questions (
                    id,
                    objective_id
                )
            `)
            .in('attempt_id', attemptIds)

        if (!orgAnswers?.length) return { success: true, topStrugglingObjectives: [] }

        // Aggregate data
        const objectiveStats = new Map<string, {
            correct: number,
            total: number,
            text: string,
            courseTitle: string
        }>()

        orgAnswers.forEach(answer => {
            const question = Array.isArray(answer.question) ? answer.question[0] : answer.question
            const objId = question?.objective_id
            if (objId) {
                const attempt = attempts.find(a => a.id === answer.attempt_id)
                const course = attempt?.course
                // Find objective text from course objectives
                const courseData = Array.isArray(course) ? course[0] : course
                const objective = courseData?.objectives?.find((o: any) => o.id === objId)

                if (objective) {
                    const key = `${attempt?.course_id}-${objId}`
                    if (!objectiveStats.has(key)) {
                        objectiveStats.set(key, {
                            correct: 0,
                            total: 0,
                            text: objective.text,
                            courseTitle: courseData?.title || 'Unknown Course'
                        })
                    }

                    const stat = objectiveStats.get(key)!
                    stat.total++
                    if (answer.is_correct) stat.correct++
                }
            }
        })

        // Calculate percentages and sort
        const results = Array.from(objectiveStats.values())
            .map(stat => ({
                objectiveText: stat.text,
                courseTitle: stat.courseTitle,
                incorrectPercentage: Math.round(((stat.total - stat.correct) / stat.total) * 100),
                totalAttempts: stat.total
            }))
            .sort((a, b) => b.incorrectPercentage - a.incorrectPercentage)
            .slice(0, 5) // Top 5

        return { success: true, topStrugglingObjectives: results }

    } catch (err: any) {
        return { success: false, error: err.message }
    }
}


export interface PerformanceFilters {
    startDate?: string;
    endDate?: string;
    role?: string;
    category?: string;
    courseId?: string;
}

export interface DetailedPerformanceData {
    coursePerformance: {
        courseId: string;
        courseTitle: string;
        avgScore: number;
        passRate: number;
        avgAttempts: number;
        totalAttempts: number;
    }[];
    strugglingObjectives: {
        objectiveText: string;
        courseTitle: string;
        incorrectPercentage: number;
        totalAttempts: number;
    }[];
    rolePerformance: {
        role: string;
        category: string;
        avgScore: number;
        completionRate: number;
        overdueRate: number;
        totalWorkers: number;
    }[];
    retrainingStats: {
        workersInRetraining: number;
        topRetrainedCourses: { title: string; count: number }[];
        retrainingCompletionRate: number;
    };
}

export async function getDetailedOrgPerformance(
    organizationId: string,
    filters: PerformanceFilters = {}
): Promise<{
    success: boolean;
    data?: DetailedPerformanceData;
    error?: string;
}> {
    try {
        const supabase = await createClient();

        // 1. Fetch Users in Org (filtered by role/category if provided)
        let userQuery = supabase
            .from('users')
            .select('id, role, job_title, worker_category')
            .eq('organization_id', organizationId);

        if (filters.role) {
            userQuery = userQuery.eq('job_title', filters.role);
        }
        if (filters.category) {
            userQuery = userQuery.eq('worker_category', filters.category);
        }

        const { data: users, error: usersError } = await userQuery;
        if (usersError) throw usersError;

        const userIds = users.map(u => u.id);
        if (userIds.length === 0) {
            return {
                success: true,
                data: {
                    coursePerformance: [],
                    strugglingObjectives: [],
                    rolePerformance: [],
                    retrainingStats: {
                        workersInRetraining: 0,
                        topRetrainedCourses: [],
                        retrainingCompletionRate: 0
                    }
                }
            };
        }

        // 2. Fetch Attempts (filtered by date/course)
        let attemptsQuery = supabase
            .from('quiz_attempts')
            .select(`
                id,
                worker_id,
                course_id,
                score,
                passed,
                attempt_number,
                created_at,
                course:courses (
                    id,
                    title,
                    objectives
                )
            `)
            .in('worker_id', userIds);

        if (filters.startDate) {
            attemptsQuery = attemptsQuery.gte('created_at', filters.startDate);
        }
        if (filters.endDate) {
            attemptsQuery = attemptsQuery.lte('created_at', filters.endDate);
        }
        if (filters.courseId) {
            attemptsQuery = attemptsQuery.eq('course_id', filters.courseId);
        }

        const { data: attempts, error: attemptsError } = await attemptsQuery;
        if (attemptsError) throw attemptsError;

        // 3. Fetch Assignments (for completion/overdue rates)
        // Note: Assignments don't always map 1:1 to attempts in time, but good for general stats
        let assignmentsQuery = supabase
            .from('course_assignments')
            .select('id, worker_id, status, course_id')
            .in('worker_id', userIds);

        if (filters.courseId) {
            assignmentsQuery = assignmentsQuery.eq('course_id', filters.courseId);
        }

        const { data: assignments, error: assignmentsError } = await assignmentsQuery;
        if (assignmentsError) throw assignmentsError;


        // --- Processing Data ---

        // A. Course Performance
        const courseStats = new Map<string, {
            title: string,
            totalScore: number,
            passedCount: number,
            attemptsCount: number,
            uniqueWorkers: Set<string>
        }>();

        attempts.forEach(a => {
            // @ts-ignore
            const title = a.course?.title || 'Unknown';
            if (!courseStats.has(a.course_id)) {
                courseStats.set(a.course_id, {
                    title,
                    totalScore: 0,
                    passedCount: 0,
                    attemptsCount: 0,
                    uniqueWorkers: new Set()
                });
            }
            const stat = courseStats.get(a.course_id)!;
            stat.totalScore += a.score;
            if (a.passed) stat.passedCount++;
            stat.attemptsCount++;
            stat.uniqueWorkers.add(a.worker_id);
        });

        const coursePerformance = Array.from(courseStats.entries()).map(([id, stat]) => ({
            courseId: id,
            courseTitle: stat.title,
            avgScore: Math.round(stat.totalScore / stat.attemptsCount),
            passRate: Math.round((stat.passedCount / stat.attemptsCount) * 100),
            avgAttempts: parseFloat((stat.attemptsCount / stat.uniqueWorkers.size).toFixed(1)),
            totalAttempts: stat.attemptsCount
        }));

        // B. Struggling Objectives (Reusing logic from getOrgPerformanceOverview but with filtered attempts)
        // We need answers for these attempts
        const attemptIds = attempts.map(a => a.id);
        let strugglingObjectives: any[] = [];

        if (attemptIds.length > 0) {
            // Fetch answers in chunks if needed, but for now assume it fits
            const { data: answers } = await supabase
                .from('quiz_answers')
                .select(`
                    is_correct,
                    attempt_id,
                    question:quiz_questions (
                        id,
                        objective_id
                    )
                `)
                .in('attempt_id', attemptIds);

            if (answers) {
                const objStats = new Map<string, { correct: number, total: number, text: string, courseTitle: string }>();

                answers.forEach(ans => {
                    const question = Array.isArray(ans.question) ? ans.question[0] : ans.question;
                    const objId = question?.objective_id;
                    if (objId) {
                        const attempt = attempts.find(a => a.id === ans.attempt_id);
                        const courseData = attempt?.course;
                        const course = Array.isArray(courseData) ? courseData[0] : courseData;
                        const objective = course?.objectives?.find((o: any) => o.id === objId);

                        if (objective) {
                            const key = `${course?.id}-${objId}`;
                            if (!objStats.has(key)) {
                                objStats.set(key, {
                                    correct: 0,
                                    total: 0,
                                    text: objective.text,
                                    courseTitle: course?.title || 'Unknown'
                                });
                            }
                            const s = objStats.get(key)!;
                            s.total++;
                            if (ans.is_correct) s.correct++;
                        }
                    }
                });

                strugglingObjectives = Array.from(objStats.values())
                    .map(s => ({
                        objectiveText: s.text,
                        courseTitle: s.courseTitle,
                        incorrectPercentage: Math.round(((s.total - s.correct) / s.total) * 100),
                        totalAttempts: s.total
                    }))
                    .sort((a, b) => b.incorrectPercentage - a.incorrectPercentage)
                    .slice(0, 5);
            }
        }

        // C. Role/Category Performance
        const roleStats = new Map<string, {
            role: string,
            category: string,
            totalScore: number,
            scoreCount: number,
            completed: number,
            overdue: number,
            totalAssignments: number,
            workerCount: Set<string>
        }>();

        // Initialize with users to ensure we have all roles represented even if no attempts
        users.forEach(u => {
            const key = `${u.job_title}-${u.worker_category}`;
            if (!roleStats.has(key)) {
                roleStats.set(key, {
                    role: u.job_title || 'Unknown',
                    category: u.worker_category || 'Unknown',
                    totalScore: 0,
                    scoreCount: 0,
                    completed: 0,
                    overdue: 0,
                    totalAssignments: 0,
                    workerCount: new Set()
                });
            }
            roleStats.get(key)!.workerCount.add(u.id);
        });

        // Add attempt scores
        attempts.forEach(a => {
            const user = users.find(u => u.id === a.worker_id);
            if (user) {
                const key = `${user.job_title}-${user.worker_category}`;
                const stat = roleStats.get(key);
                if (stat) {
                    stat.totalScore += a.score;
                    stat.scoreCount++;
                }
            }
        });

        // Add assignment stats
        assignments.forEach(a => {
            const user = users.find(u => u.id === a.worker_id);
            if (user) {
                const key = `${user.job_title}-${user.worker_category}`;
                const stat = roleStats.get(key);
                if (stat) {
                    stat.totalAssignments++;
                    if (a.status === 'completed') stat.completed++;
                    if (a.status === 'overdue') stat.overdue++;
                }
            }
        });

        const rolePerformance = Array.from(roleStats.values())
            .filter(s => s.scoreCount > 0 || s.totalAssignments > 0) // Only show active roles
            .map(s => ({
                role: s.role,
                category: s.category,
                avgScore: s.scoreCount > 0 ? Math.round(s.totalScore / s.scoreCount) : 0,
                completionRate: s.totalAssignments > 0 ? Math.round((s.completed / s.totalAssignments) * 100) : 0,
                overdueRate: s.totalAssignments > 0 ? Math.round((s.overdue / s.totalAssignments) * 100) : 0,
                totalWorkers: s.workerCount.size
            }));

        // D. Retraining Stats
        // Logic: Workers who have taken the same course multiple times (attempt_number > 1)
        // or have failed attempts recently.
        // Let's define "Retraining" as attempts > 1.

        const retrainingAttempts = attempts.filter(a => a.attempt_number > 1);
        const workersInRetraining = new Set(retrainingAttempts.map(a => a.worker_id)).size;

        const retrainedCoursesMap = new Map<string, number>();
        retrainingAttempts.forEach(a => {
            // @ts-ignore
            const title = a.course?.title || 'Unknown';
            retrainedCoursesMap.set(title, (retrainedCoursesMap.get(title) || 0) + 1);
        });

        const topRetrainedCourses = Array.from(retrainedCoursesMap.entries())
            .map(([title, count]) => ({ title, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Retraining completion rate: % of retraining attempts that passed
        const retrainingPassCount = retrainingAttempts.filter(a => a.passed).length;
        const retrainingCompletionRate = retrainingAttempts.length > 0
            ? Math.round((retrainingPassCount / retrainingAttempts.length) * 100)
            : 0;

        return {
            success: true,
            data: {
                coursePerformance,
                strugglingObjectives,
                rolePerformance,
                retrainingStats: {
                    workersInRetraining,
                    topRetrainedCourses,
                    retrainingCompletionRate
                }
            }
        };

    } catch (err: any) {
        console.error('Error getting detailed performance:', err);
        return { success: false, error: err.message };
    }
}
