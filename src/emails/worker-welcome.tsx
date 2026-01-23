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

interface WorkerWelcomeEmailProps {
    workerName: string;
    organizationName: string;
    loginUrl: string;
    tempPassword: string;
    assignedCourses: string[];
}

export default function WorkerWelcomeEmail({
    workerName = "John Doe",
    organizationName = "Example Organization",
    loginUrl = "https://example.com/login",
    tempPassword = "temp123",
    assignedCourses = ["Course 1", "Course 2"],
}: WorkerWelcomeEmailProps) {
    return (
        <Html>
            <Head />
            <Preview>Welcome to {organizationName} Training Portal</Preview>
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
                        To get started with your training, please log in using the credentials below:
                    </Text>

                    <Section style={credentialsBox}>
                        <Text style={credentialLabel}>Temporary Password:</Text>
                        <Text style={credentialValue}>{tempPassword}</Text>
                        <Text style={credentialNote}>
                            You will be prompted to change this password on first login.
                        </Text>
                    </Section>

                    <Section style={buttonContainer}>
                        <Button style={button} href={loginUrl}>
                            Access Training Portal
                        </Button>
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
    padding: "0 40px",
};

const text = {
    color: "#475569",
    fontSize: "16px",
    lineHeight: "24px",
    margin: "16px 0",
    padding: "0 40px",
};

const courseList = {
    padding: "0 40px",
    margin: "16px 0",
};

const courseItem = {
    color: "#475569",
    fontSize: "16px",
    lineHeight: "28px",
    margin: "0",
};

const credentialsBox = {
    backgroundColor: "#f1f5f9",
    borderRadius: "8px",
    padding: "20px",
    margin: "24px 40px",
};

const credentialLabel = {
    color: "#64748b",
    fontSize: "14px",
    fontWeight: "600",
    margin: "0 0 8px 0",
};

const credentialValue = {
    color: "#1e293b",
    fontSize: "20px",
    fontWeight: "bold",
    fontFamily: "monospace",
    margin: "0 0 12px 0",
};

const credentialNote = {
    color: "#64748b",
    fontSize: "12px",
    margin: "0",
    fontStyle: "italic",
};

const buttonContainer = {
    padding: "27px 40px",
};

const button = {
    backgroundColor: "#4f46e5",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "16px",
    fontWeight: "600",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "block",
    padding: "12px 20px",
};

const footer = {
    color: "#94a3b8",
    fontSize: "12px",
    lineHeight: "16px",
    margin: "32px 0 0 0",
    padding: "0 40px",
};
