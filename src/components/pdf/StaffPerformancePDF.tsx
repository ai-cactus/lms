import React from 'react';
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
        width: '22%',
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
        width: '35%',
    },
    courseProgress: {
        fontSize: 10,
        color: '#6B7280',
        width: '20%',
        textAlign: 'center',
    },
    courseStatus: {
        fontSize: 10,
        width: '20%',
        textAlign: 'center',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 3,
    },
    courseScore: {
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
});

interface StaffPerformancePDFProps {
    staffMember: {
        full_name: string;
        email: string;
        role: string;
        created_at: string;
    };
    assignments: Array<{
        course: {
            title: string;
            difficulty?: string;
        };
        status: string;
        progress_percentage: number;
        assigned_at: string;
        completed_at?: string;
        completion?: {
            quiz_score: number;
        } | null;
    }>;
    stats: {
        totalAssigned: number;
        completed: number;
        failed: number;
        active: number;
    };
    organizationName: string;
}

export const StaffPerformancePDF = ({
    staffMember,
    assignments,
    stats,
    organizationName,
}: StaffPerformancePDFProps) => {
    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'completed':
                return { backgroundColor: '#D1FAE5', color: '#065F46' };
            case 'failed':
                return { backgroundColor: '#FEE2E2', color: '#DC2626' };
            case 'in_progress':
                return { backgroundColor: '#DBEAFE', color: '#1E40AF' };
            default:
                return { backgroundColor: '#F3F4F6', color: '#6B7280' };
        }
    };

    const formatStatus = (status: string) => {
        switch (status) {
            case 'not_started':
                return 'Not Started';
            case 'in_progress':
                return 'In Progress';
            case 'completed':
                return 'Completed';
            case 'failed':
                return 'Failed';
            default:
                return status;
        }
    };

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>Staff Performance Report</Text>
                    <Text style={styles.subtitle}>
                        {organizationName} • Generated on {new Date().toLocaleDateString()}
                    </Text>
                </View>

                {/* Staff Information */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Staff Information</Text>
                    <View style={styles.row}>
                        <Text style={styles.label}>Name</Text>
                        <Text style={styles.value}>{staffMember.full_name}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.label}>Email</Text>
                        <Text style={styles.value}>{staffMember.email}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.label}>Role</Text>
                        <Text style={styles.value}>{staffMember.role}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.label}>Member Since</Text>
                        <Text style={styles.value}>
                            {new Date(staffMember.created_at).toLocaleDateString()}
                        </Text>
                    </View>
                </View>

                {/* Performance Statistics */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Performance Statistics</Text>
                    <View style={styles.statBox}>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{stats.totalAssigned}</Text>
                            <Text style={styles.statLabel}>Total Courses Assigned</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{stats.completed}</Text>
                            <Text style={styles.statLabel}>Courses Completed</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{stats.failed}</Text>
                            <Text style={styles.statLabel}>Courses Failed</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{stats.active}</Text>
                            <Text style={styles.statLabel}>Active Courses</Text>
                        </View>
                    </View>
                </View>

                {/* Course Assignments */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Course Assignments</Text>
                    <View style={styles.tableHeader}>
                        <Text style={[styles.headerText, { width: '35%' }]}>Course Name</Text>
                        <Text style={[styles.headerText, { width: '20%', textAlign: 'center' }]}>Progress</Text>
                        <Text style={[styles.headerText, { width: '20%', textAlign: 'center' }]}>Status</Text>
                        <Text style={[styles.headerText, { width: '15%', textAlign: 'center' }]}>Score</Text>
                        <Text style={[styles.headerText, { width: '10%', textAlign: 'right' }]}>Date</Text>
                    </View>
                    {assignments.map((assignment, index) => (
                        <View key={index} style={styles.courseRow}>
                            <Text style={styles.courseName}>
                                {assignment.course?.title || 'Unknown Course'}
                                {assignment.course?.difficulty && (
                                    <Text style={{ fontSize: 9, color: '#6B7280' }}>
                                        {'\n'}{assignment.course.difficulty}
                                    </Text>
                                )}
                            </Text>
                            <Text style={styles.courseProgress}>
                                {assignment.progress_percentage || 0}%
                            </Text>
                            <View style={[styles.courseStatus, getStatusStyle(assignment.status)]}>
                                <Text>{formatStatus(assignment.status)}</Text>
                            </View>
                            <Text style={styles.courseScore}>
                                {assignment.completion?.quiz_score ? `${assignment.completion.quiz_score}%` : '-'}
                            </Text>
                            <Text style={styles.courseDate}>
                                {assignment.completed_at
                                    ? new Date(assignment.completed_at).toLocaleDateString('en-US', {
                                          month: 'short',
                                          day: 'numeric'
                                      })
                                    : new Date(assignment.assigned_at).toLocaleDateString('en-US', {
                                          month: 'short',
                                          day: 'numeric'
                                      })
                                }
                            </Text>
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
};
