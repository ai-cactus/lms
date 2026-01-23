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

interface WorkerWelcomeAutoLoginEmailProps {
    workerName: string;
    organizationName: string;
    autoLoginUrl: string;
    assignedCourses: string[];
    hasAutoLogin: boolean;
}

export default function WorkerWelcomeAutoLoginEmail({
    workerName = "John Doe",
    organizationName = "Example Organization",
    autoLoginUrl = "https://example.com/auto-login",
    assignedCourses = ["Course 1", "Course 2"],
    hasAutoLogin = true,
}: WorkerWelcomeAutoLoginEmailProps) {
    return (
        <Html>
            <Head />
            <Preview>Welcome to {organizationName} Training Portal - Start Your Training</Preview>
            <Body style={main}>
                <Container style={container}>
                    <Heading style={h1}>Welcome to Theraptly Training</Heading>

                    <Text style={text}>Hello {workerName},</Text>

                    <Text style={text}>
                        Welcome to {organizationName}! Your training account has been created and you have been
                        assigned the following courses:
                    </Text>

                    <Section style={courseList}>
                        {assignedCourses.map((course, index) => (
                            <Text key={index} style={courseItem}>
                                • {course}
                            </Text>
                        ))}
                    </Section>

                    <Text style={text}>
                        {hasAutoLogin
                            ? "Click the button below to automatically access your training portal and start your courses:"
                            : "Click the button below to access your training portal:"
                        }
                    </Text>

                    <Section style={buttonContainer}>
                        <Button style={button} href={autoLoginUrl}>
                            {hasAutoLogin ? "Start Training Now" : "Access Training Portal"}
                        </Button>
                    </Section>

                    {hasAutoLogin ? (
                        <Text style={text}>
                            <strong>No login required!</strong> This secure link will automatically sign you in and take you directly to your assigned courses.
                        </Text>
                    ) : (
                        <Text style={text}>
                            You will need to log in with your email address and the temporary password provided separately.
                        </Text>
                    )}

                    <Text style={text}>
                        <strong>Important:</strong>
                    </Text>
                    <Section style={importantBox}>
                        <Text style={importantText}>
                            • This link is secure and personalized for you
                        </Text>
                        <Text style={importantText}>
                            • The link will expire in 24 hours for security
                        </Text>
                        <Text style={importantText}>
                            • Complete all assigned courses by their deadlines
                        </Text>
                        <Text style={importantText}>
                            • Contact your supervisor if you have any questions
                        </Text>
                    </Section>

                    <Text style={text}>
                        If you have any questions or need assistance, please contact your administrator.
                    </Text>

                    <Text style={footer}>
                        This is an automated message from Theraptly LMS. Please do not reply to this email.
                    </Text>
                </Container>
            </Body>
        </Html>
    );
}

const main = {
    backgroundColor: "#f6f9fc",
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
    backgroundColor: "#ffffff",
    margin: "0 auto",
    padding: "20px 0 48px",
    marginBottom: "64px",
    maxWidth: "600px",
};

const h1 = {
    color: "#1e293b",
    fontSize: "24px",
    fontWeight: "bold",
    margin: "40px 0",
    padding: "0",
    textAlign: "center" as const,
};

const text = {
    color: "#374151",
    fontSize: "16px",
    lineHeight: "24px",
    margin: "16px 0",
};

const courseList = {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "20px",
    margin: "20px 0",
};

const courseItem = {
    color: "#1e293b",
    fontSize: "16px",
    fontWeight: "500",
    margin: "8px 0",
};

const buttonContainer = {
    textAlign: "center" as const,
    margin: "32px 0",
};

const button = {
    backgroundColor: "#4f46e5",
    borderRadius: "8px",
    color: "#ffffff",
    fontSize: "16px",
    fontWeight: "bold",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "inline-block",
    padding: "16px 32px",
    margin: "0 auto",
};

const importantBox = {
    backgroundColor: "#fef3c7",
    border: "1px solid #f59e0b",
    borderRadius: "8px",
    padding: "16px",
    margin: "20px 0",
};

const importantText = {
    color: "#92400e",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "4px 0",
};

const footer = {
    color: "#6b7280",
    fontSize: "12px",
    lineHeight: "16px",
    margin: "32px 0 0 0",
    textAlign: "center" as const,
};
