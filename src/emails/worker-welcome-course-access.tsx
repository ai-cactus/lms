import {
    Body,
    Button,
    Container,
    Head,
    Heading,
    Html,
    Preview,
    Section,
    Text,
} from "@react-email/components";

interface CourseAccessLink {
    courseTitle: string;
    courseDescription: string;
    autoLoginUrl: string;
    assignmentId: string;
}

interface WorkerWelcomeCourseAccessEmailProps {
    workerName: string;
    organizationName: string;
    courseAccessLinks: CourseAccessLink[];
    fallbackLoginUrl: string;
    hasAutoLogin: boolean;
    tempPassword?: string;
}

export default function WorkerWelcomeCourseAccessEmail({
    workerName = "John Doe",
    organizationName = "Example Organization",
    courseAccessLinks = [
        {
            courseTitle: "Sample Course",
            courseDescription: "This is a sample course description",
            autoLoginUrl: "https://example.com/auto-login",
            assignmentId: "123"
        }
    ],
    fallbackLoginUrl = "https://example.com/login",
    hasAutoLogin = true,
    tempPassword,
}: WorkerWelcomeCourseAccessEmailProps) {
    return (
        <Html>
            <Head />
            <Preview>Welcome to {organizationName} - Your Training Portal is Ready</Preview>
            <Body style={main}>
                <Container style={container}>
                    {/* Header */}
                    <Section style={headerSection}>
                        <Heading style={h1}>Welcome to {organizationName} Training Centre</Heading>
                        <Text style={subtitle}>Your account is active. Courses will appear here once they&apos;re assigned.</Text>
                    </Section>

                    {/* Greeting */}
                    <Section style={greetingSection}>
                        <Text style={greetingText}>Hi {workerName},</Text>
                        <Text style={introText}>
                            Your training account is ready.
                        </Text>
                        <Text style={introText}>
                            When your supervisor/admin assigns courses, they&apos;ll appear in your dashboard and you&apos;ll receive a notification.
                        </Text>
                        <Text style={introText}>
                            To protect your account, you&apos;ll be prompted to change your password on first login.
                        </Text>
                    </Section>

                    {tempPassword && (
                        <Section style={infoBox}>
                            <Text style={infoTitle}>Your Login Credentials</Text>
                            <Text style={infoText}>
                                A temporary password has been generated for you. You will be required to change this password when you first log in.
                            </Text>
                            <Section style={{ background: "#e2e8f0", padding: "12px", borderRadius: "6px", margin: "10px 0", textAlign: "center" }}>
                                <Text style={{ fontFamily: "monospace", fontSize: "18px", fontWeight: "bold", margin: 0, letterSpacing: "1px", color: "#1e293b" }}>
                                    {tempPassword}
                                </Text>
                            </Section>
                            <Text style={{ fontSize: "12px", color: "#64748b", fontStyle: "italic", margin: "5px 0 0 0", textAlign: "center" }}>
                                Use this password if auto-login links expire or when logging in manually.
                            </Text>
                        </Section>
                    )}

                    {courseAccessLinks.length > 0 ? (
                        <>
                            {/* Course Access Section */}
                            <Section style={coursesSection}>
                                <Text style={sectionTitle}> Your Assigned Training Courses</Text>
                                <Text style={sectionSubtitle}>
                                    Click the buttons below to start your training immediately - no login required!
                                </Text>

                                {courseAccessLinks.map((course, index) => (
                                    <Section key={index} style={courseCard}>
                                        <Section style={courseHeader}>
                                            <Text style={courseTitle}>{course.courseTitle}</Text>
                                            {course.courseDescription && (
                                                <Text style={courseDescription}>{course.courseDescription}</Text>
                                            )}
                                        </Section>

                                        <Section style={buttonContainer}>
                                            <Button style={primaryButton} href={course.autoLoginUrl}>
                                                Start Course Now
                                            </Button>
                                        </Section>

                                        <Text style={autoLoginNote}>
                                            <strong>One-click access!</strong> Automatically logs you in and takes you directly to the course.
                                        </Text>
                                    </Section>
                                ))}
                            </Section>

                            <Section style={infoBox}>
                                <Text style={infoTitle}>How It Works</Text>
                                <Text style={infoText}>
                                    • <strong>One-click access</strong> - No passwords or manual login required
                                </Text>
                                <Text style={infoText}>
                                    • <strong>Instant training</strong> - Start learning immediately after clicking
                                </Text>
                                <Text style={infoText}>
                                    • <strong>Progress tracking</strong> - Your completion status is automatically saved
                                </Text>
                                <Text style={infoText}>
                                    • <strong>Mobile friendly</strong> - Access your training from any device
                                </Text>
                            </Section>
                        </>
                    ) : (
                        <Text style={introText}>
                            You don&apos;t have any courses assigned yet. Your supervisor will assign courses to you soon.
                        </Text>
                    )}

                    <Section style={securityBox}>
                        <Text style={securityTitle}>Security & Access Checklist</Text>
                        <Text style={securityText}>
                            • <strong>Unique access:</strong> This sign-in link is tied to your account, don&apos;t share it.
                        </Text>
                        <Text style={securityText}>
                            • <strong>Link expires in 30 days:</strong> If it expires, request a new link from your supervisor/admin.
                        </Text>
                        <Text style={securityText}>
                            • <strong>Meet deadlines:</strong> Complete courses before the due dates shown in your dashboard.
                        </Text>
                        <Text style={securityText}>
                            • <strong>Need help?</strong> Contact your supervisor/admin.
                        </Text>
                    </Section>

                    {/* Alternative Access */}
                    <Section style={alternativeSection}>
                        <Text style={alternativeTitle}>Alternative Access</Text>
                        <Text style={alternativeText}>
                            You can also access your complete training dashboard:
                        </Text>

                        <Section style={buttonContainer}>
                            <Button style={secondaryButton} href={fallbackLoginUrl}>
                                View All Training
                            </Button>
                        </Section>

                        <Text style={autoLoginNote}>
                            This also provides one-click login to your training portal.
                        </Text>
                    </Section>

                    {/* Support */}
                    <Section style={supportSection}>
                        <Text style={supportText}>
                            <strong>Need assistance?</strong> Contact your supervisor or training administrator for help with your courses.
                        </Text>
                    </Section>

                    {/* Footer */}
                    <Section style={footerSection}>
                        <Text style={footerText}>
                            This is an automated message from the {organizationName} Training System.
                        </Text>
                        <Text style={footerNote}>
                            Please do not reply to this email. For support, contact your administrator.
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}

const main = {
    backgroundColor: "#f8fafc",
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
    backgroundColor: "#ffffff",
    margin: "0 auto",
    padding: "0",
    maxWidth: "600px",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
};

const headerSection = {
    backgroundColor: "#4f46e5",
    padding: "40px 30px",
    textAlign: "center" as const,
};

const h1 = {
    color: "#ffffff",
    fontSize: "32px",
    fontWeight: "bold",
    margin: "0 0 8px 0",
    padding: "0",
    textAlign: "center" as const,
};

const subtitle = {
    color: "#e0e7ff",
    fontSize: "16px",
    fontWeight: "500",
    margin: "0",
    textAlign: "center" as const,
};

const greetingSection = {
    padding: "30px",
    backgroundColor: "#ffffff",
};

const greetingText = {
    color: "#1e293b",
    fontSize: "20px",
    fontWeight: "600",
    margin: "0 0 16px 0",
};

const introText = {
    color: "#4b5563",
    fontSize: "16px",
    lineHeight: "24px",
    margin: "0",
};

const coursesSection = {
    padding: "0 30px 30px",
};

const sectionTitle = {
    color: "#1e293b",
    fontSize: "24px",
    fontWeight: "bold",
    margin: "0 0 8px 0",
    textAlign: "center" as const,
};

const sectionSubtitle = {
    color: "#6b7280",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "0 0 24px 0",
    textAlign: "center" as const,
};

const courseCard = {
    backgroundColor: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "24px",
    margin: "16px 0",
    boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
};

const courseHeader = {
    marginBottom: "20px",
};

const courseTitle = {
    color: "#1e293b",
    fontSize: "18px",
    fontWeight: "bold",
    margin: "0 0 8px 0",
};

const courseDescription = {
    color: "#6b7280",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "0",
};

const buttonContainer = {
    textAlign: "center" as const,
    margin: "20px 0",
};

const primaryButton = {
    backgroundColor: "#4f46e5",
    borderRadius: "8px",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: "600",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "inline-block",
    padding: "12px 24px",
    margin: "0 auto",
    boxShadow: "0 4px 6px -1px rgba(79, 70, 229, 0.2)",
    border: "1px solid #4f46e5",
};

const secondaryButton = {
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    color: "#4f46e5",
    fontSize: "14px",
    fontWeight: "600",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "inline-block",
    padding: "12px 24px",
    margin: "0 auto",
    border: "1px solid #4f46e5",
};

const autoLoginNote = {
    color: "#059669",
    fontSize: "12px",
    lineHeight: "16px",
    margin: "8px 0 0 0",
    textAlign: "center" as const,
    fontStyle: "italic",
};

const infoBox = {
    backgroundColor: "#eff6ff",
    border: "1px solid #dbeafe",
    borderRadius: "8px",
    padding: "24px",
    margin: "24px 0",
};

const infoTitle = {
    color: "#1e40af",
    fontSize: "18px",
    fontWeight: "bold",
    margin: "0 0 16px 0",
};

const infoText = {
    color: "#3730a3",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "6px 0",
};

const securityBox = {
    backgroundColor: "#f0fdf4",
    border: "1px solid #dcfce7",
    borderRadius: "8px",
    padding: "24px",
    margin: "24px 0",
};

const securityTitle = {
    color: "#166534",
    fontSize: "18px",
    fontWeight: "bold",
    margin: "0 0 16px 0",
};

const securityText = {
    color: "#166534",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "6px 0",
};

const alternativeSection = {
    padding: "0 30px 30px",
};

const alternativeTitle = {
    color: "#1e293b",
    fontSize: "18px",
    fontWeight: "bold",
    margin: "0 0 8px 0",
    textAlign: "center" as const,
};

const alternativeText = {
    color: "#6b7280",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "0 0 16px 0",
    textAlign: "center" as const,
};

const supportSection = {
    padding: "0 30px 30px",
    backgroundColor: "#f9fafb",
};

const supportText = {
    color: "#374151",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "0",
    textAlign: "center" as const,
};

const footerSection = {
    padding: "20px 30px",
    backgroundColor: "#f3f4f6",
    borderTop: "1px solid #e5e7eb",
};

const footerText = {
    color: "#6b7280",
    fontSize: "12px",
    lineHeight: "16px",
    margin: "0 0 8px 0",
    textAlign: "center" as const,
};

const footerNote = {
    color: "#9ca3af",
    fontSize: "11px",
    lineHeight: "14px",
    margin: "0",
    textAlign: "center" as const,
};
