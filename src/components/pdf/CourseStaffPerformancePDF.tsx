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
    staffRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        paddingVertical: 8,
    },
    staffName: {
        fontSize: 11,
        color: '#111827',
        width: '35%',
    },
    staffRole: {
        fontSize: 9,
        color: '#6B7280',
        width: '20%',
    },
    staffScore: {
        fontSize: 10,
        fontWeight: 'bold',
        width: '15%',
        textAlign: 'center',
    },
    staffStatus: {
        fontSize: 10,
        width: '20%',
        textAlign: 'center',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 3,
    },
    staffProgress: {
        fontSize: 10,
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

interface CourseStaffPerformancePDFProps {
    courseTitle: string;
    organizationName: string;
    courseStats: {
        totalLearners: number;
        completionRate: number;
        averageScore: number;
        averageDuration: number;
    };
    staffPerformance: Array<{
        worker_name: string;
        worker_role?: string;
        score: number | null;
        status: string;
        progress: number;
    }>;
}

export const CourseStaffPerformancePDF = ({
    courseTitle,
    organizationName,
    courseStats,
    staffPerformance,
}: CourseStaffPerformancePDFProps) => {
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
                    <Text style={styles.title}>Course Staff Performance Report</Text>
                    <Text style={styles.subtitle}>
                        {organizationName} • {courseTitle} • Generated on {new Date().toLocaleDateString()}
                    </Text>
                </View>

                {/* Course Information */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Course Overview</Text>
                    <View style={styles.row}>
                        <Text style={styles.label}>Course Title</Text>
                        <Text style={styles.value}>{courseTitle}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.label}>Organization</Text>
                        <Text style={styles.value}>{organizationName}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.label}>Report Generated</Text>
                        <Text style={styles.value}>{new Date().toLocaleDateString()}</Text>
                    </View>
                </View>

                {/* Course Statistics */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Course Statistics</Text>
                    <View style={styles.statBox}>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{courseStats.totalLearners}</Text>
                            <Text style={styles.statLabel}>Total Learners</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{courseStats.completionRate}%</Text>
                            <Text style={styles.statLabel}>Completion Rate</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{courseStats.averageScore}%</Text>
                            <Text style={styles.statLabel}>Average Score</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{courseStats.averageDuration}</Text>
                            <Text style={styles.statLabel}>Avg Duration (mins)</Text>
                        </View>
                    </View>
                </View>

                {/* Staff Performance Table */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Staff Performance Details</Text>
                    <View style={styles.tableHeader}>
                        <Text style={[styles.headerText, { width: '35%' }]}>Staff Name</Text>
                        <Text style={[styles.headerText, { width: '20%', textAlign: 'center' }]}>Role</Text>
                        <Text style={[styles.headerText, { width: '15%', textAlign: 'center' }]}>Score</Text>
                        <Text style={[styles.headerText, { width: '20%', textAlign: 'center' }]}>Status</Text>
                        <Text style={[styles.headerText, { width: '10%', textAlign: 'right' }]}>Progress</Text>
                    </View>
                    {staffPerformance.map((staff, index) => (
                        <View key={index} style={styles.staffRow}>
                            <Text style={styles.staffName}>{staff.worker_name}</Text>
                            <Text style={styles.staffRole}>{staff.worker_role || 'N/A'}</Text>
                            <Text style={styles.staffScore}>
                                {staff.score !== null ? `${staff.score}%` : '-'}
                            </Text>
                            <View style={[styles.staffStatus, getStatusStyle(staff.status)]}>
                                <Text>{formatStatus(staff.status)}</Text>
                            </View>
                            <Text style={styles.staffProgress}>{staff.progress}%</Text>
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
