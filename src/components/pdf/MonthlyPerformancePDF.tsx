import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

// Register fonts if needed (optional, using standard fonts for now)
// Font.register({ family: 'Roboto', src: '...' });

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
        width: '45%',
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

interface MonthlyPerformancePDFProps {
    organizationName: string;
    month: string;
    coursePerformance: {
        title: string;
        passRate: number;
        avgScore: number;
    }[];
    strugglingObjectives: {
        text: string;
        incorrectRate: number;
    }[];
    retrainingStats: {
        workersInRetraining: number;
        completionRate: number;
    };
}

export const MonthlyPerformancePDF = ({
    organizationName,
    month,
    coursePerformance,
    strugglingObjectives,
    retrainingStats,
}: MonthlyPerformancePDFProps) => (
    <Document>
        <Page size="A4" style={styles.page}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.title}>Monthly Performance Report</Text>
                <Text style={styles.subtitle}>{organizationName} • {month}</Text>
            </View>

            {/* Retraining Stats - Key Metrics */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Retraining Effectiveness</Text>
                <View style={styles.statBox}>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{retrainingStats.workersInRetraining}</Text>
                        <Text style={styles.statLabel}>Workers in Retraining</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{retrainingStats.completionRate}%</Text>
                        <Text style={styles.statLabel}>Retraining Success Rate</Text>
                    </View>
                </View>
            </View>

            {/* Course Performance */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Course Performance</Text>
                <View style={styles.row}>
                    <Text style={[styles.label, { fontWeight: 'bold' }]}>Course Title</Text>
                    <Text style={[styles.value, { fontWeight: 'bold' }]}>Pass Rate / Avg Score</Text>
                </View>
                {coursePerformance.slice(0, 10).map((course, index) => (
                    <View key={index} style={styles.row}>
                        <Text style={styles.label}>{course.title}</Text>
                        <Text style={styles.value}>{course.passRate}% / {course.avgScore}%</Text>
                    </View>
                ))}
            </View>

            {/* Struggling Objectives */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Areas for Improvement (Top 5)</Text>
                <View style={styles.row}>
                    <Text style={[styles.label, { fontWeight: 'bold' }]}>Objective</Text>
                    <Text style={[styles.value, { fontWeight: 'bold' }]}>Failure Rate</Text>
                </View>
                {strugglingObjectives.map((obj, index) => (
                    <View key={index} style={styles.row}>
                        <Text style={styles.label}>{obj.text}</Text>
                        <Text style={[styles.value, { color: '#DC2626' }]}>{obj.incorrectRate}%</Text>
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
