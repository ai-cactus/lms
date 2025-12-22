import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
    page: {
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        padding: 30,
        fontFamily: 'Helvetica',
    },
    header: {
        marginBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        paddingBottom: 10,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    subtitle: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 4,
    },
    section: {
        margin: 10,
        padding: 10,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 10,
        color: '#374151',
        backgroundColor: '#F3F4F6',
        padding: 5,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        paddingVertical: 5,
    },
    label: {
        fontSize: 10,
        color: '#4B5563',
        width: '70%',
    },
    value: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#111827',
        width: '30%',
        textAlign: 'right',
    },
    statBox: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginVertical: 10,
    },
    statItem: {
        alignItems: 'center',
        padding: 10,
        backgroundColor: '#F9FAFB',
        borderRadius: 4,
        width: '30%',
    },
    statValue: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#4F46E5',
    },
    statLabel: {
        fontSize: 10,
        color: '#6B7280',
        marginTop: 4,
        textAlign: 'center',
    },
    courseRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        paddingVertical: 8,
    },
    courseName: {
        fontSize: 11,
        color: '#111827',
        width: '40%',
    },
    courseLevel: {
        fontSize: 10,
        color: '#6B7280',
        width: '20%',
    },
    courseAssigned: {
        fontSize: 10,
        color: '#111827',
        width: '15%',
        textAlign: 'center',
    },
    courseCompletion: {
        fontSize: 10,
        fontWeight: 'bold',
        width: '15%',
        textAlign: 'center',
    },
    courseDate: {
        fontSize: 9,
        color: '#6B7280',
        width: '10%',
        textAlign: 'right',
    },
    tableHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#F9FAFB',
        paddingVertical: 8,
        paddingHorizontal: 5,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    headerText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#374151',
    },
    footer: {
        position: 'absolute',
        bottom: 30,
        left: 30,
        right: 30,
        textAlign: 'center',
        color: '#9CA3AF',
        fontSize: 8,
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
        paddingTop: 10,
    },
});

interface TrainingCenterPDFProps {
    organizationName: string;
    stats: {
        totalCourses: number;
        totalStaffAssigned: number;
        averageGrade: number;
    };
    courses: Array<{
        title: string;
        level: string;
        assignedStaff: number;
        completion: number;
        dateCreated: string;
    }>;
    coverageData: {
        completed: number;
        inProgress: number;
        notStarted: number;
    };
}

const TrainingCenterPDF = ({
    organizationName,
    stats,
    courses,
    coverageData,
}: TrainingCenterPDFProps) => (
    <Document>
        <Page size="A4" style={styles.page}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.title}>Training Center Report</Text>
                <Text style={styles.subtitle}>
                    {organizationName} • Generated on {new Date().toLocaleDateString()}
                </Text>
            </View>

            {/* Overview Statistics */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Training Overview</Text>
                <View style={styles.statBox}>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{stats.totalCourses}</Text>
                        <Text style={styles.statLabel}>Total Courses</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{stats.totalStaffAssigned}</Text>
                        <Text style={styles.statLabel}>Staff Assigned</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{stats.averageGrade}%</Text>
                        <Text style={styles.statLabel}>Avg Completion</Text>
                    </View>
                </View>
            </View>

            {/* Coverage Statistics */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Training Coverage</Text>
                <View style={styles.statBox}>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{coverageData.completed}%</Text>
                        <Text style={styles.statLabel}>Completed</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{coverageData.inProgress}%</Text>
                        <Text style={styles.statLabel}>In Progress</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{coverageData.notStarted}%</Text>
                        <Text style={styles.statLabel}>Not Started</Text>
                    </View>
                </View>
            </View>

            {/* Courses Table */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent Courses</Text>
                <View style={styles.tableHeader}>
                    <Text style={[styles.headerText, { width: '40%' }]}>Course Name</Text>
                    <Text style={[styles.headerText, { width: '20%', textAlign: 'center' }]}>Level</Text>
                    <Text style={[styles.headerText, { width: '15%', textAlign: 'center' }]}>Assigned</Text>
                    <Text style={[styles.headerText, { width: '15%', textAlign: 'center' }]}>Completion</Text>
                    <Text style={[styles.headerText, { width: '10%', textAlign: 'right' }]}>Created</Text>
                </View>
                {courses.map((course, index) => (
                    <View key={index} style={styles.courseRow}>
                        <Text style={styles.courseName}>{course.title}</Text>
                        <Text style={styles.courseLevel}>{course.level}</Text>
                        <Text style={styles.courseAssigned}>{course.assignedStaff}</Text>
                        <Text style={styles.courseCompletion}>{course.completion}%</Text>
                        <Text style={styles.courseDate}>{course.dateCreated}</Text>
                    </View>
                ))}
            </View>

            {/* Footer */}
            <Text style={styles.footer}>
                Generated automatically by Theraptly LMS on {new Date().toLocaleDateString()}
            </Text>
        </Page>
    </Document>
);

export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();

        // Get authenticated user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's organization
        const { data: userData } = await supabase
            .from('users')
            .select('organization_id, organization:organizations(name)')
            .eq('id', user.id)
            .single();

        if (!userData?.organization_id) {
            return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
        }

        const orgId = userData.organization_id;
        const orgName = (userData.organization as any)?.name || 'Organization';

        // Fetch training stats
        const { data: coursesData } = await supabase
            .from('courses')
            .select('id, title, objectives, created_at')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(10);

        const totalCourses = (coursesData || []).length;

        // Get staff count
        const { count: staffCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('role', 'worker');

        // Fetch course stats
        const coursesWithStats = await Promise.all(
            (coursesData || []).map(async (course) => {
                // Count total assignments
                const { count: assignmentsCount } = await supabase
                    .from('course_assignments')
                    .select('*', { count: 'exact', head: true })
                    .eq('course_id', course.id);

                // Count completed assignments
                const { count: completedCount } = await supabase
                    .from('course_completions')
                    .select('*', { count: 'exact', head: true })
                    .eq('course_id', course.id);

                const completion = assignmentsCount
                    ? Math.round(((completedCount || 0) / assignmentsCount) * 100)
                    : 0;

                return {
                    title: course.title,
                    level: course.objectives?.difficulty || 'Beginner',
                    assignedStaff: assignmentsCount || 0,
                    completion,
                    dateCreated: new Date(course.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                    }),
                };
            })
        );

        const totalAssigned = coursesWithStats.reduce((sum, course) => sum + course.assignedStaff, 0);
        const avgCompletion = coursesWithStats.length
            ? Math.round(coursesWithStats.reduce((sum, course) => sum + course.completion, 0) / coursesWithStats.length)
            : 0;

        const stats = {
            totalCourses,
            totalStaffAssigned: totalAssigned,
            averageGrade: avgCompletion,
        };

        // Get coverage data
        const { count: totalStaff } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('role', 'worker');

        let coverageData = { completed: 0, inProgress: 0, notStarted: 100 };

        if (totalStaff && totalStaff > 0) {
            const { data: workers } = await supabase
                .from('users')
                .select('id')
                .eq('organization_id', orgId)
                .eq('role', 'worker');

            const workerIds = workers?.map(w => w.id) || [];

            const { data: assignments } = await supabase
                .from('course_assignments')
                .select('status, worker_id')
                .in('worker_id', workerIds);

            const workerStatuses = new Map();
            assignments?.forEach(assignment => {
                const workerId = assignment.worker_id;
                const currentStatus = workerStatuses.get(workerId);

                if (!currentStatus ||
                    (assignment.status === 'completed' && currentStatus !== 'completed') ||
                    (assignment.status === 'in_progress' && currentStatus === 'not_started')) {
                    workerStatuses.set(workerId, assignment.status);
                }
            });

            const completed = Array.from(workerStatuses.values()).filter(s => s === 'completed').length;
            const inProgress = Array.from(workerStatuses.values()).filter(s => s === 'in_progress').length;
            const notStarted = totalStaff - completed - inProgress;

            coverageData = {
                completed: Math.round((completed / totalStaff) * 100),
                inProgress: Math.round((inProgress / totalStaff) * 100),
                notStarted: Math.round((notStarted / totalStaff) * 100),
            };
        }

        // Generate PDF
        const pdfBuffer = await renderToBuffer(
            <TrainingCenterPDF
                organizationName={orgName}
                stats={stats}
                courses={coursesWithStats}
                coverageData={coverageData}
            />
        );

        // Return PDF as downloadable file
        const filename = `Training_Center_Report_${new Date().toISOString().split('T')[0]}.pdf`;

        return new NextResponse(pdfBuffer, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });

    } catch (error) {
        console.error('Error generating training center PDF:', error);
        return NextResponse.json(
            { error: 'Failed to generate PDF report' },
            { status: 500 }
        );
    }
}
