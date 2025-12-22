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
        textAlign: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 14,
        color: '#6B7280',
    },
    scoreSection: {
        marginBottom: 20,
        padding: 15,
        backgroundColor: '#F8FAFC',
        borderRadius: 8,
    },
    scoreText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        textAlign: 'center',
        marginBottom: 10,
    },
    statsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    statBox: {
        alignItems: 'center',
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
    questionSection: {
        marginBottom: 15,
    },
    questionHeader: {
        flexDirection: 'row',
        marginBottom: 8,
    },
    questionNumber: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#111827',
        width: 30,
    },
    questionText: {
        fontSize: 12,
        color: '#111827',
        flex: 1,
    },
    answerRow: {
        marginBottom: 6,
        padding: 8,
        borderRadius: 4,
    },
    correctAnswer: {
        backgroundColor: '#DCFCE7',
        borderLeftWidth: 4,
        borderLeftColor: '#16A34A',
    },
    wrongAnswer: {
        backgroundColor: '#FEF2F2',
        borderLeftWidth: 4,
        borderLeftColor: '#DC2626',
    },
    answerText: {
        fontSize: 11,
        color: '#374151',
    },
    explanation: {
        marginTop: 6,
        padding: 8,
        backgroundColor: '#F8FAFC',
        borderRadius: 4,
    },
    explanationText: {
        fontSize: 10,
        color: '#6B7280',
        fontStyle: 'italic',
    },
});

interface QuizResultsPDFProps {
    courseTitle: string;
    workerName: string;
    completedAt: string;
    score: number;
    passed: boolean;
    questions: Array<{
        id: string;
        question_text: string;
        options?: string[];
        correct_answer: string;
        explanation?: string;
        selectedAnswer?: string;
        isCorrect?: boolean;
    }>;
}

export const QuizResultsPDF: React.FC<QuizResultsPDFProps> = ({
    courseTitle,
    workerName,
    completedAt,
    score,
    passed,
    questions,
}) => {
    const correctAnswers = questions.filter(q => q.isCorrect).length;
    const totalQuestions = questions.length;

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <View style={styles.header}>
                    <Text style={styles.title}>Quiz Results</Text>
                    <Text style={styles.subtitle}>{courseTitle}</Text>
                </View>

                <View style={styles.scoreSection}>
                    <Text style={styles.scoreText}>
                        Score: {score}% - {passed ? 'PASSED' : 'FAILED'}
                    </Text>

                    <View style={styles.statsContainer}>
                        <View style={styles.statBox}>
                            <Text style={styles.statValue}>{totalQuestions}</Text>
                            <Text style={styles.statLabel}>TOTAL QUESTIONS</Text>
                        </View>
                        <View style={styles.statBox}>
                            <Text style={styles.statValue}>{correctAnswers}</Text>
                            <Text style={styles.statLabel}>CORRECT</Text>
                        </View>
                        <View style={styles.statBox}>
                            <Text style={styles.statValue}>{totalQuestions - correctAnswers}</Text>
                            <Text style={styles.statLabel}>INCORRECT</Text>
                        </View>
                    </View>
                </View>

                <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 15, color: '#111827' }}>
                    Detailed Answers
                </Text>

                {questions.map((question, index) => (
                    <View key={question.id} style={styles.questionSection}>
                        <View style={styles.questionHeader}>
                            <Text style={styles.questionNumber}>{index + 1}.</Text>
                            <Text style={styles.questionText}>
                                {typeof question.question_text === 'string'
                                    ? question.question_text
                                    : 'Question text not available'}
                            </Text>
                        </View>

                        {question.options?.map((option, optIndex) => {
                            const isCorrect = option === question.correct_answer;
                            const isSelected = option === question.selectedAnswer;

                            return (
                                <View
                                    key={optIndex}
                                    style={[
                                        styles.answerRow,
                                        isCorrect ? styles.correctAnswer : (isSelected ? styles.wrongAnswer : {})
                                    ]}
                                >
                                    <Text style={styles.answerText}>
                                        {option}
                                        {isCorrect && ' ✓'}
                                        {isSelected && !isCorrect && ' ✗'}
                                    </Text>
                                </View>
                            );
                        })}

                        {question.explanation && (
                            <View style={styles.explanation}>
                                <Text style={styles.explanationText}>
                                    Explanation: {question.explanation}
                                </Text>
                            </View>
                        )}
                    </View>
                ))}

                <View style={{ marginTop: 30, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#E5E7EB' }}>
                    <Text style={{ fontSize: 10, color: '#6B7280', textAlign: 'center' }}>
                        Generated on {new Date().toLocaleDateString()} for {workerName}
                    </Text>
                </View>
            </Page>
        </Document>
    );
};
