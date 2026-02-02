const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
    console.log('Starting improved seed with quiz data...');

    // Get the admin user (course creator)
    const admin = await prisma.user.findFirst({
        where: { profile: { role: 'admin' } },
        include: { profile: true }
    });

    if (!admin) {
        console.log('No admin user found! Please sign up via the app first.');
        return;
    }

    console.log(`Seeding for admin: ${admin.email}`);

    // Clean up old seed data
    console.log('Cleaning up old seed data...');
    await prisma.quizAttempt.deleteMany({});
    await prisma.enrollment.deleteMany({
        where: { user: { email: { contains: '@company.com' } } }
    });
    await prisma.enrollment.deleteMany({
        where: { user: { email: 'dummy_staff_01@example.com' } }
    });
    await prisma.user.deleteMany({
        where: {
            email: {
                in: [
                    'dummy_staff_01@example.com',
                    'sarah.johnson@company.com',
                    'michael.chen@company.com',
                    'jessica.williams@company.com',
                    'david.martinez@company.com',
                    'emily.taylor@company.com'
                ]
            }
        }
    });

    // Create realistic staff users
    const staffData = [
        { email: 'sarah.johnson@company.com', firstName: 'Sarah', lastName: 'Johnson' },
        { email: 'michael.chen@company.com', firstName: 'Michael', lastName: 'Chen' },
        { email: 'jessica.williams@company.com', firstName: 'Jessica', lastName: 'Williams' },
        { email: 'david.martinez@company.com', firstName: 'David', lastName: 'Martinez' },
        { email: 'emily.taylor@company.com', firstName: 'Emily', lastName: 'Taylor' },
    ];

    const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
    const staffUsers = [];

    for (const s of staffData) {
        console.log(`Creating staff: ${s.firstName} ${s.lastName}`);
        const user = await prisma.user.create({
            data: {
                email: s.email,
                password: hashedPassword,
                profile: {
                    create: {
                        email: s.email,
                        firstName: s.firstName,
                        lastName: s.lastName,
                        fullName: `${s.firstName} ${s.lastName}`,
                        role: 'worker'
                    }
                }
            }
        });
        staffUsers.push(user);
    }

    // Quiz questions template for each course
    const quizQuestions = {
        'HIPAA Privacy Training': [
            {
                text: 'What does HIPAA stand for?',
                options: [
                    { id: 'A', text: 'Health Insurance Portability and Accountability Act' },
                    { id: 'B', text: 'Healthcare Information Privacy and Access Act' },
                    { id: 'C', text: 'Hospital Insurance Protection Administration Act' },
                    { id: 'D', text: 'Health Information Protection and Access Act' }
                ], correctAnswer: 'A'
            },
            {
                text: 'Which of the following is considered Protected Health Information (PHI)?',
                options: [
                    { id: 'A', text: 'Patient name and address' },
                    { id: 'B', text: 'Social Security number' },
                    { id: 'C', text: 'Medical diagnosis' },
                    { id: 'D', text: 'All of the above' }
                ], correctAnswer: 'D'
            },
            {
                text: 'How long must HIPAA records be retained?',
                options: [
                    { id: 'A', text: '3 years' },
                    { id: 'B', text: '6 years' },
                    { id: 'C', text: '10 years' },
                    { id: 'D', text: 'Indefinitely' }
                ], correctAnswer: 'B'
            },
            {
                text: 'What is the maximum penalty for a HIPAA violation?',
                options: [
                    { id: 'A', text: '$10,000 per violation' },
                    { id: 'B', text: '$50,000 per violation' },
                    { id: 'C', text: '$1.5 million per year' },
                    { id: 'D', text: 'Up to 10 years imprisonment' }
                ], correctAnswer: 'C'
            },
            {
                text: 'Who can access a patient\'s PHI without authorization?',
                options: [
                    { id: 'A', text: 'Anyone in the hospital' },
                    { id: 'B', text: 'Only the treating physician' },
                    { id: 'C', text: 'Those involved in treatment, payment, or operations' },
                    { id: 'D', text: 'Family members only' }
                ], correctAnswer: 'C'
            },
        ],
        'Fire Safety Protocols': [
            {
                text: 'What does the acronym PASS stand for in fire extinguisher use?',
                options: [
                    { id: 'A', text: 'Pull, Aim, Squeeze, Sweep' },
                    { id: 'B', text: 'Push, Activate, Spray, Stop' },
                    { id: 'C', text: 'Prepare, Alert, Spray, Secure' },
                    { id: 'D', text: 'Point, Aim, Shoot, Sweep' }
                ], correctAnswer: 'A'
            },
            {
                text: 'How often should fire drills be conducted in a workplace?',
                options: [
                    { id: 'A', text: 'Monthly' },
                    { id: 'B', text: 'Quarterly' },
                    { id: 'C', text: 'Annually' },
                    { id: 'D', text: 'Every 6 months' }
                ], correctAnswer: 'D'
            },
            {
                text: 'What should you do first when you discover a fire?',
                options: [
                    { id: 'A', text: 'Try to extinguish it' },
                    { id: 'B', text: 'Pull the fire alarm' },
                    { id: 'C', text: 'Call 911' },
                    { id: 'D', text: 'Evacuate immediately' }
                ], correctAnswer: 'B'
            },
            {
                text: 'Which type of fire extinguisher is used for electrical fires?',
                options: [
                    { id: 'A', text: 'Class A' },
                    { id: 'B', text: 'Class B' },
                    { id: 'C', text: 'Class C' },
                    { id: 'D', text: 'Class D' }
                ], correctAnswer: 'C'
            },
        ],
        'Data Security Awareness': [
            {
                text: 'What is phishing?',
                options: [
                    { id: 'A', text: 'A type of malware' },
                    { id: 'B', text: 'A social engineering attack using fake emails' },
                    { id: 'C', text: 'A network security protocol' },
                    { id: 'D', text: 'A password cracking technique' }
                ], correctAnswer: 'B'
            },
            {
                text: 'How often should passwords be changed?',
                options: [
                    { id: 'A', text: 'Never, if using a password manager' },
                    { id: 'B', text: 'Every 30 days' },
                    { id: 'C', text: 'Every 90 days or when compromised' },
                    { id: 'D', text: 'Only when required by IT' }
                ], correctAnswer: 'C'
            },
            {
                text: 'What is two-factor authentication?',
                options: [
                    { id: 'A', text: 'Using two different passwords' },
                    { id: 'B', text: 'Logging in from two devices' },
                    { id: 'C', text: 'Verifying identity with two different methods' },
                    { id: 'D', text: 'Having two administrators approve access' }
                ], correctAnswer: 'C'
            },
            {
                text: 'What should you do if you receive a suspicious email?',
                options: [
                    { id: 'A', text: 'Delete it immediately' },
                    { id: 'B', text: 'Report it to IT security' },
                    { id: 'C', text: 'Forward it to colleagues to verify' },
                    { id: 'D', text: 'Click the link to check if it\'s real' }
                ], correctAnswer: 'B'
            },
            {
                text: 'Which is a strong password?',
                options: [
                    { id: 'A', text: 'password123' },
                    { id: 'B', text: 'Birthday1990' },
                    { id: 'C', text: 'K9$mP2#xL7!' },
                    { id: 'D', text: 'qwerty' }
                ], correctAnswer: 'C'
            },
        ],
        'Workplace Harassment Policy': [
            {
                text: 'What constitutes workplace harassment?',
                options: [
                    { id: 'A', text: 'Only physical contact' },
                    { id: 'B', text: 'Only verbal abuse' },
                    { id: 'C', text: 'Any unwelcome conduct based on protected characteristics' },
                    { id: 'D', text: 'Only actions by supervisors' }
                ], correctAnswer: 'C'
            },
            {
                text: 'Who can be held liable for workplace harassment?',
                options: [
                    { id: 'A', text: 'Only the harasser' },
                    { id: 'B', text: 'Only the employer' },
                    { id: 'C', text: 'Both the harasser and employer' },
                    { id: 'D', text: 'Only HR department' }
                ], correctAnswer: 'C'
            },
            {
                text: 'What should you do if you witness harassment?',
                options: [
                    { id: 'A', text: 'Ignore it' },
                    { id: 'B', text: 'Report it to management or HR' },
                    { id: 'C', text: 'Confront the harasser directly' },
                    { id: 'D', text: 'Discuss it with coworkers only' }
                ], correctAnswer: 'B'
            },
            {
                text: 'Is a single incident enough to constitute harassment?',
                options: [
                    { id: 'A', text: 'No, it must be repeated' },
                    { id: 'B', text: 'Yes, if severe enough' },
                    { id: 'C', text: 'Only if physical' },
                    { id: 'D', text: 'Never' }
                ], correctAnswer: 'B'
            },
        ],
        'Code of Conduct': [
            {
                text: 'What is the purpose of a code of conduct?',
                options: [
                    { id: 'A', text: 'To restrict employee freedom' },
                    { id: 'B', text: 'To outline expected behaviors and ethical standards' },
                    { id: 'C', text: 'To replace employment contracts' },
                    { id: 'D', text: 'To monitor employees' }
                ], correctAnswer: 'B'
            },
            {
                text: 'What should you do if asked to violate the code of conduct?',
                options: [
                    { id: 'A', text: 'Comply if a supervisor asks' },
                    { id: 'B', text: 'Refuse and report the request' },
                    { id: 'C', text: 'Ignore the code if it benefits the company' },
                    { id: 'D', text: 'Wait and see what happens' }
                ], correctAnswer: 'B'
            },
            {
                text: 'Does the code of conduct apply outside work hours?',
                options: [
                    { id: 'A', text: 'Never' },
                    { id: 'B', text: 'When representing the company' },
                    { id: 'C', text: 'Only on social media' },
                    { id: 'D', text: 'Always, 24/7' }
                ], correctAnswer: 'B'
            },
            {
                text: 'What is a conflict of interest?',
                options: [
                    { id: 'A', text: 'Disagreeing with a coworker' },
                    { id: 'B', text: 'When personal interests conflict with professional duties' },
                    { id: 'C', text: 'Competing with another company' },
                    { id: 'D', text: 'Having multiple jobs' }
                ], correctAnswer: 'B'
            },
        ],
    };

    // Course data with lessons
    const coursesData = [
        { title: 'HIPAA Privacy Training', difficulty: 'advanced', category: 'compliance', duration: 45 },
        { title: 'Fire Safety Protocols', difficulty: 'beginner', category: 'safety', duration: 30 },
        { title: 'Data Security Awareness', difficulty: 'intermediate', category: 'compliance', duration: 60 },
        { title: 'Workplace Harassment Policy', difficulty: 'advanced', category: 'hr', duration: 40 },
        { title: 'Code of Conduct', difficulty: 'beginner', category: 'hr', duration: 25 },
    ];

    const courses = [];
    for (const c of coursesData) {
        let course = await prisma.course.findFirst({
            where: { title: c.title, createdBy: admin.id },
            include: { lessons: { include: { quiz: { include: { questions: true } } } } }
        });

        if (!course) {
            console.log(`Creating course: ${c.title}`);
            course = await prisma.course.create({
                data: {
                    title: c.title,
                    difficulty: c.difficulty,
                    category: c.category,
                    duration: c.duration,
                    createdBy: admin.id,
                    status: 'published',
                    description: `Comprehensive training on ${c.title.toLowerCase()}.`,
                    thumbnail: `/images/icon-course-${c.difficulty === 'beginner' ? 'blue' : 'dark'}.svg`
                },
                include: { lessons: { include: { quiz: { include: { questions: true } } } } }
            });
        }

        // Check if course has a lesson with quiz
        if (course.lessons.length === 0) {
            console.log(`  Creating quiz for: ${c.title}`);
            const questions = quizQuestions[c.title] || [];

            await prisma.lesson.create({
                data: {
                    courseId: course.id,
                    title: `${c.title} Assessment`,
                    content: `Complete the following assessment to test your knowledge of ${c.title}.`,
                    order: 1,
                    quiz: {
                        create: {
                            title: `${c.title} Quiz`,
                            passingScore: 70,
                            questions: {
                                create: questions.map((q, idx) => ({
                                    text: q.text,
                                    type: 'multiple_choice',
                                    options: q.options,
                                    correctAnswer: q.correctAnswer,
                                    order: idx + 1
                                }))
                            }
                        }
                    }
                }
            });

            // Reload course with quiz data
            course = await prisma.course.findFirst({
                where: { id: course.id },
                include: { lessons: { include: { quiz: { include: { questions: true } } } } }
            });
        }

        courses.push(course);
    }

    // Enrollment patterns with varied scores
    const enrollmentPatterns = [
        // Sarah: High performer - completes all with high scores
        { staffIndex: 0, courseIndices: [0, 1, 2, 3, 4], status: 'completed', scoreRange: [85, 98] },
        // Michael: Completed 3, in progress 2
        { staffIndex: 1, courseIndices: [0, 1, 2], status: 'completed', scoreRange: [72, 88] },
        { staffIndex: 1, courseIndices: [3, 4], status: 'in_progress', scoreRange: null },
        // Jessica: Mixed - one perfect, one failed, in progress, enrolled
        { staffIndex: 2, courseIndices: [0], status: 'completed', scoreRange: [95, 100] },
        { staffIndex: 2, courseIndices: [1], status: 'completed', scoreRange: [55, 65] }, // Failed
        { staffIndex: 2, courseIndices: [2], status: 'in_progress', scoreRange: null },
        { staffIndex: 2, courseIndices: [3, 4], status: 'enrolled', scoreRange: null },
        // David: Just started - in progress on 2, enrolled on 3
        { staffIndex: 3, courseIndices: [0, 1], status: 'in_progress', scoreRange: null },
        { staffIndex: 3, courseIndices: [2, 3, 4], status: 'enrolled', scoreRange: null },
        // Emily: Strong performer - completed 4, in progress 1
        { staffIndex: 4, courseIndices: [0, 1, 2, 3], status: 'completed', scoreRange: [80, 95] },
        { staffIndex: 4, courseIndices: [4], status: 'in_progress', scoreRange: null },
    ];

    console.log('Creating enrollments with quiz attempts...');
    for (const pattern of enrollmentPatterns) {
        const staff = staffUsers[pattern.staffIndex];
        for (const courseIndex of pattern.courseIndices) {
            const course = courses[courseIndex];

            // Check if enrollment already exists
            const existing = await prisma.enrollment.findUnique({
                where: { userId_courseId: { userId: staff.id, courseId: course.id } }
            });

            if (existing) continue;

            // Generate score for completed enrollments
            const score = pattern.scoreRange ?
                Math.floor(Math.random() * (pattern.scoreRange[1] - pattern.scoreRange[0])) + pattern.scoreRange[0] :
                null;

            const enrollment = await prisma.enrollment.create({
                data: {
                    userId: staff.id,
                    courseId: course.id,
                    status: pattern.status,
                    progress: pattern.status === 'completed' ? 100 :
                        pattern.status === 'in_progress' ? Math.floor(Math.random() * 60) + 20 : 0,
                    score: score,
                    completedAt: pattern.status === 'completed' ? new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) : null
                }
            });

            // Create QuizAttempt for completed enrollments
            if (pattern.status === 'completed' && course.lessons[0]?.quiz) {
                const quiz = course.lessons[0].quiz;
                const questions = quiz.questions;

                // Generate answers based on target score
                const targetCorrect = Math.round((score / 100) * questions.length);
                const answers = questions.map((q, idx) => {
                    // Get correct answer for first targetCorrect questions
                    if (idx < targetCorrect) {
                        return { questionId: q.id, selectedAnswer: q.correctAnswer };
                    } else {
                        // Wrong answer - pick a different option
                        const wrongOptions = ['A', 'B', 'C', 'D'].filter(o => o !== q.correctAnswer);
                        return { questionId: q.id, selectedAnswer: wrongOptions[Math.floor(Math.random() * wrongOptions.length)] };
                    }
                });

                await prisma.quizAttempt.create({
                    data: {
                        enrollmentId: enrollment.id,
                        quizId: quiz.id,
                        answers: answers,
                        score: score,
                        timeTaken: Math.floor(Math.random() * 20 + 10) * 60, // 10-30 minutes in seconds
                        completedAt: enrollment.completedAt
                    }
                });
            }
        }
    }

    // Summary stats
    const totalEnrollments = await prisma.enrollment.count({
        where: { course: { createdBy: admin.id } }
    });
    const completedCount = await prisma.enrollment.count({
        where: { course: { createdBy: admin.id }, status: 'completed' }
    });
    const inProgressCount = await prisma.enrollment.count({
        where: { course: { createdBy: admin.id }, status: 'in_progress' }
    });
    const enrolledCount = await prisma.enrollment.count({
        where: { course: { createdBy: admin.id }, status: 'enrolled' }
    });
    const quizAttemptCount = await prisma.quizAttempt.count();

    console.log('\n=== Seed Summary ===');
    console.log(`Staff Users Created: ${staffUsers.length}`);
    console.log(`Courses: ${courses.length}`);
    console.log(`Total Enrollments: ${totalEnrollments}`);
    console.log(`  - Completed: ${completedCount} (${Math.round(completedCount / totalEnrollments * 100)}%)`);
    console.log(`  - In Progress: ${inProgressCount} (${Math.round(inProgressCount / totalEnrollments * 100)}%)`);
    console.log(`  - Not Started: ${enrolledCount} (${Math.round(enrolledCount / totalEnrollments * 100)}%)`);
    console.log(`Quiz Attempts: ${quizAttemptCount}`);
    console.log('====================\n');

    console.log('Seeding complete!');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
