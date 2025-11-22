import {
    Body,
    Button,
    Container,
    Head,
    Heading,
    Hr,
    Html,
    Link,
    Preview,
    Section,
    Text,
    Tailwind,
    Row,
    Column,
} from "@react-email/components";
import * as React from "react";

interface MonthlyOverviewEmailProps {
    organizationName: string;
    month: string;
    topCourses: { title: string; completionRate: number }[];
    strugglingObjectives: { text: string; incorrectRate: number }[];
    retrainingStats: { workersInRetraining: number; completionRate: number };
    reportUrl: string;
}

export const MonthlyOverviewEmail = ({
    organizationName = "Acme Care",
    month = "October 2023",
    topCourses = [
        { title: "Infection Control", completionRate: 98 },
        { title: "Fire Safety", completionRate: 95 },
    ],
    strugglingObjectives = [
        { text: "Proper handwashing technique", incorrectRate: 45 },
        { text: "Evacuation routes", incorrectRate: 30 },
    ],
    retrainingStats = { workersInRetraining: 12, completionRate: 75 },
    reportUrl = "http://localhost:3000/admin/analytics/performance",
}: MonthlyOverviewEmailProps) => {
    const previewText = `Monthly Performance Overview for ${organizationName} - ${month}`;

    return (
        <Html>
            <Head />
            <Preview>{previewText}</Preview>
            <Tailwind>
                <Body className="bg-white my-auto mx-auto font-sans">
                    <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] w-[465px]">
                        <Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
                            Monthly Performance Overview
                        </Heading>
                        <Text className="text-black text-[14px] leading-[24px] text-center">
                            {month} Summary for <strong>{organizationName}</strong>
                        </Text>

                        {/* Top Courses */}
                        <Section className="mt-[32px]">
                            <Heading as="h3" className="text-[16px] font-semibold text-gray-900 m-0 mb-[12px]">
                                Top Performing Courses
                            </Heading>
                            {topCourses.map((course, index) => (
                                <Row key={index} className="mb-[8px]">
                                    <Column>
                                        <Text className="text-[14px] text-gray-700 m-0 truncate max-w-[250px]">{course.title}</Text>
                                    </Column>
                                    <Column align="right">
                                        <Text className="text-[14px] font-bold text-green-600 m-0">{course.completionRate}%</Text>
                                    </Column>
                                </Row>
                            ))}
                        </Section>

                        <Hr className="border border-solid border-[#eaeaea] my-[20px] mx-0 w-full" />

                        {/* Struggling Objectives */}
                        <Section>
                            <Heading as="h3" className="text-[16px] font-semibold text-gray-900 m-0 mb-[12px]">
                                Areas for Improvement
                            </Heading>
                            {strugglingObjectives.map((obj, index) => (
                                <Row key={index} className="mb-[8px]">
                                    <Column>
                                        <Text className="text-[14px] text-gray-700 m-0 truncate max-w-[250px]">{obj.text}</Text>
                                    </Column>
                                    <Column align="right">
                                        <Text className="text-[14px] font-bold text-red-600 m-0">{obj.incorrectRate}% Fail</Text>
                                    </Column>
                                </Row>
                            ))}
                        </Section>

                        <Hr className="border border-solid border-[#eaeaea] my-[20px] mx-0 w-full" />

                        {/* Retraining Stats */}
                        <Section>
                            <Heading as="h3" className="text-[16px] font-semibold text-gray-900 m-0 mb-[12px]">
                                Retraining Effectiveness
                            </Heading>
                            <Row>
                                <Column>
                                    <Text className="text-[14px] text-gray-600 m-0">Workers in Retraining</Text>
                                    <Text className="text-[18px] font-bold text-gray-900 m-0">{retrainingStats.workersInRetraining}</Text>
                                </Column>
                                <Column align="right">
                                    <Text className="text-[14px] text-gray-600 m-0">Success Rate</Text>
                                    <Text className="text-[18px] font-bold text-green-600 m-0">{retrainingStats.completionRate}%</Text>
                                </Column>
                            </Row>
                        </Section>

                        <Section className="text-center mt-[32px] mb-[32px]">
                            <Button
                                className="bg-[#4f46e5] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
                                href={reportUrl}
                            >
                                View Full Report
                            </Button>
                        </Section>

                        <Text className="text-[#666666] text-[12px] leading-[24px]">
                            A detailed PDF report is available for download in your admin dashboard.
                        </Text>
                    </Container>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default MonthlyOverviewEmail;
