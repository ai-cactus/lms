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

interface TrainingReminderEmailProps {
    workerName: string;
    courseTitle: string;
    deadline: string;
    daysRemaining: number;
    loginUrl: string;
}

export default function TrainingReminderEmail({
    workerName = "John Doe",
    courseTitle = "HIPAA Compliance Training",
    deadline = "December 31, 2024",
    daysRemaining = 7,
    loginUrl = "https://example.com/login",
}: TrainingReminderEmailProps) {
    const isUrgent = daysRemaining <= 3;
    const isOverdue = daysRemaining < 0;

    return (
        <Html>
            <Head />
            <Preview>
                {isOverdue
                    ? `Overdue: ${courseTitle}`
                    : `Reminder: ${courseTitle} due in ${daysRemaining} days`}
            </Preview>
            <Body style={main}>
                <Container style={container}>
                    <Heading style={h1}>
                        {isOverdue ? "⚠️ Training Overdue" : "📚 Training Reminder"}
                    </Heading>

                    <Text style={text}>Hi {workerName},</Text>

                    {isOverdue ? (
                        <Text style={text}>
                            Your required training <strong>{courseTitle}</strong> was due on {deadline} and is now{" "}
                            <strong style={{ color: "#dc2626" }}>
                                {Math.abs(daysRemaining)} day{Math.abs(daysRemaining) !== 1 ? "s" : ""} overdue
                            </strong>
                            .
                        </Text>
                    ) : (
                        <Text style={text}>
                            This is a friendly reminder that your required training <strong>{courseTitle}</strong>{" "}
                            is due in{" "}
                            <strong style={{ color: isUrgent ? "#dc2626" : "#4f46e5" }}>
                                {daysRemaining} day{daysRemaining !== 1 ? "s" : ""}
                            </strong>
                            .
                        </Text>
                    )}

                    <Section style={deadlineBox(isOverdue, isUrgent)}>
                        <Text style={deadlineLabel}>Deadline:</Text>
                        <Text style={deadlineValue}>{deadline}</Text>
                    </Section>

                    <Text style={text}>
                        {isOverdue
                            ? "Please complete this training as soon as possible to maintain compliance."
                            : "Please log in to complete your training before the deadline."}
                    </Text>

                    <Section style={buttonContainer}>
                        <Button style={button(isOverdue)} href={loginUrl}>
                            {isOverdue ? "Complete Training Now" : "Start Training"}
                        </Button>
                    </Section>

                    <Text style={text}>
                        The training includes:
                        <br />
                        • Review of course materials
                        <br />
                        • Knowledge assessment quiz (80% passing score)
                        <br />
                        • Digital acknowledgment form
                        <br />
                    </Text>

                    <Text style={footer}>
                        This is an automated reminder from Theraptly LMS. If you have already completed this
                        training, please disregard this message.
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

const deadlineBox = (isOverdue: boolean, isUrgent: boolean) => ({
    backgroundColor: isOverdue ? "#fef2f2" : isUrgent ? "#fef3c7" : "#f1f5f9",
    borderLeft: `4px solid ${isOverdue ? "#dc2626" : isUrgent ? "#f59e0b" : "#4f46e5"}`,
    borderRadius: "8px",
    padding: "20px",
    margin: "24px 40px",
});

const deadlineLabel = {
    color: "#64748b",
    fontSize: "14px",
    fontWeight: "600",
    margin: "0 0 8px 0",
};

const deadlineValue = {
    color: "#1e293b",
    fontSize: "20px",
    fontWeight: "bold",
    margin: "0",
};

const buttonContainer = {
    padding: "27px 40px",
};

const button = (isOverdue: boolean) => ({
    backgroundColor: isOverdue ? "#dc2626" : "#4f46e5",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "16px",
    fontWeight: "600",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "block",
    padding: "12px 20px",
});

const footer = {
    color: "#94a3b8",
    fontSize: "12px",
    lineHeight: "16px",
    margin: "32px 0 0 0",
    padding: "0 40px",
};
