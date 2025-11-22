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

interface WeeklySnapshotEmailProps {
    organizationName: string;
    overdueCount: number;
    pendingConfirmations: number;
    complianceRate: number;
    roleCompliance: { role: string; rate: number }[];
    dashboardUrl: string;
}

export const WeeklySnapshotEmail = ({
    organizationName = "Acme Care",
    overdueCount = 5,
    pendingConfirmations = 3,
    complianceRate = 85,
    roleCompliance = [
        { role: "Nurse", rate: 90 },
        { role: "Caregiver", rate: 80 },
    ],
    dashboardUrl = "http://localhost:3000/admin/dashboard",
}: WeeklySnapshotEmailProps) => {
    const previewText = `Weekly Compliance Snapshot for ${organizationName}`;

    return (
        <Html>
            <Head />
            <Preview>{previewText}</Preview>
            <Tailwind>
                <Body className="bg-white my-auto mx-auto font-sans">
                    <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] w-[465px]">
                        <Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
                            Weekly Compliance Snapshot
                        </Heading>
                        <Text className="text-black text-[14px] leading-[24px]">
                            Here is your weekly training compliance summary for <strong>{organizationName}</strong>.
                        </Text>

                        <Section className="mt-[32px] mb-[32px]">
                            <Row>
                                <Column className="text-center">
                                    <Text className="text-[36px] font-bold text-red-600 m-0">{overdueCount}</Text>
                                    <Text className="text-[12px] text-gray-500 m-0 uppercase tracking-wider">Overdue</Text>
                                </Column>
                                <Column className="text-center">
                                    <Text className="text-[36px] font-bold text-yellow-600 m-0">{pendingConfirmations}</Text>
                                    <Text className="text-[12px] text-gray-500 m-0 uppercase tracking-wider">Pending</Text>
                                </Column>
                                <Column className="text-center">
                                    <Text className="text-[36px] font-bold text-green-600 m-0">{complianceRate}%</Text>
                                    <Text className="text-[12px] text-gray-500 m-0 uppercase tracking-wider">Compliance</Text>
                                </Column>
                            </Row>
                        </Section>

                        <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />

                        <Heading as="h3" className="text-[18px] font-medium text-gray-900 m-0 mb-[16px]">
                            Compliance by Role
                        </Heading>

                        <Section>
                            {roleCompliance.map((item, index) => (
                                <Row key={index} className="mb-[8px]">
                                    <Column>
                                        <Text className="text-[14px] text-gray-700 m-0">{item.role}</Text>
                                    </Column>
                                    <Column align="right">
                                        <Text className={`text-[14px] font-bold m-0 ${item.rate >= 90 ? 'text-green-600' : item.rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                                            {item.rate}%
                                        </Text>
                                    </Column>
                                </Row>
                            ))}
                        </Section>

                        <Section className="text-center mt-[32px] mb-[32px]">
                            <Button
                                className="bg-[#4f46e5] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
                                href={dashboardUrl}
                            >
                                Open Dashboard
                            </Button>
                        </Section>

                        <Text className="text-[#666666] text-[12px] leading-[24px]">
                            This email was sent automatically based on your organization's settings.
                            You can manage these notifications in your <Link href={`${dashboardUrl}/../settings`} className="text-blue-600 underline">Admin Settings</Link>.
                        </Text>
                    </Container>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default WeeklySnapshotEmail;
