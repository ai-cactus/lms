// CARF-mandated courses by role and program type

export interface CARFCourse {
    id: string;
    title: string;
    carfStandard: string;
    required: boolean;
    description: string;
}

export const ROLES = [
    "Direct Care Staff",
    "Peer Support Specialist",
    "Clinical Staff",
    "Administrative Staff",
    "Case Manager",
] as const;

export type WorkerRole = typeof ROLES[number];

// CARF course recommendations by role and program type
export const CARF_COURSE_MAPPING: Record<string, Record<WorkerRole, CARFCourse[]>> = {
    "Behavioral Health": {
        "Direct Care Staff": [
            {
                id: "infection-control",
                title: "Infection Control & Prevention",
                carfStandard: "1.H.12.b",
                required: true,
                description: "Prevent infections and protect clients",
            },
            {
                id: "rights-responsibilities",
                title: "Rights & Responsibilities of Persons Served",
                carfStandard: "1.A.9",
                required: true,
                description: "Understand client rights and dignity",
            },
            {
                id: "crisis-intervention",
                title: "Crisis Intervention & De-escalation",
                carfStandard: "2.C.1",
                required: true,
                description: "Safely manage behavioral crises",
            },
            {
                id: "confidentiality",
                title: "Confidentiality & HIPAA Compliance",
                carfStandard: "1.I.1",
                required: true,
                description: "Protect client privacy and information",
            },
            {
                id: "trauma-informed-care",
                title: "Trauma-Informed Care Principles",
                carfStandard: "2.A.3",
                required: false,
                description: "Understand trauma and its impact",
            },
        ],
        "Peer Support Specialist": [
            {
                id: "peer-support-ethics",
                title: "Peer Support Ethics & Boundaries",
                carfStandard: "2.B.5",
                required: true,
                description: "Maintain professional boundaries",
            },
            {
                id: "rights-responsibilities",
                title: "Rights & Responsibilities of Persons Served",
                carfStandard: "1.A.9",
                required: true,
                description: "Understand client rights and dignity",
            },
            {
                id: "confidentiality",
                title: "Confidentiality & HIPAA Compliance",
                carfStandard: "1.I.1",
                required: true,
                description: "Protect client privacy and information",
            },
            {
                id: "recovery-principles",
                title: "Recovery-Oriented Practices",
                carfStandard: "2.A.1",
                required: true,
                description: "Support person-centered recovery",
            },
        ],
        "Clinical Staff": [
            {
                id: "assessment-documentation",
                title: "Assessment & Documentation Standards",
                carfStandard: "2.D.1",
                required: true,
                description: "Proper clinical documentation",
            },
            {
                id: "treatment-planning",
                title: "Person-Centered Treatment Planning",
                carfStandard: "2.E.1",
                required: true,
                description: "Develop individualized treatment plans",
            },
            {
                id: "confidentiality",
                title: "Confidentiality & HIPAA Compliance",
                carfStandard: "1.I.1",
                required: true,
                description: "Protect client privacy and information",
            },
            {
                id: "medication-management",
                title: "Medication Management & Safety",
                carfStandard: "1.H.10",
                required: true,
                description: "Safe medication practices",
            },
            {
                id: "crisis-intervention",
                title: "Crisis Intervention & De-escalation",
                carfStandard: "2.C.1",
                required: true,
                description: "Safely manage behavioral crises",
            },
        ],
        "Administrative Staff": [
            {
                id: "confidentiality",
                title: "Confidentiality & HIPAA Compliance",
                carfStandard: "1.I.1",
                required: true,
                description: "Protect client privacy and information",
            },
            {
                id: "rights-responsibilities",
                title: "Rights & Responsibilities of Persons Served",
                carfStandard: "1.A.9",
                required: true,
                description: "Understand client rights and dignity",
            },
            {
                id: "data-security",
                title: "Data Security & Records Management",
                carfStandard: "1.I.3",
                required: true,
                description: "Secure handling of client records",
            },
        ],
        "Case Manager": [
            {
                id: "case-management-standards",
                title: "Case Management Standards",
                carfStandard: "2.F.1",
                required: true,
                description: "Effective case coordination",
            },
            {
                id: "resource-coordination",
                title: "Resource Coordination & Referrals",
                carfStandard: "2.F.3",
                required: true,
                description: "Connect clients to resources",
            },
            {
                id: "confidentiality",
                title: "Confidentiality & HIPAA Compliance",
                carfStandard: "1.I.1",
                required: true,
                description: "Protect client privacy and information",
            },
            {
                id: "rights-responsibilities",
                title: "Rights & Responsibilities of Persons Served",
                carfStandard: "1.A.9",
                required: true,
                description: "Understand client rights and dignity",
            },
        ],
    },
    "Substance Abuse Treatment": {
        "Direct Care Staff": [
            {
                id: "substance-use-basics",
                title: "Substance Use Disorder Basics",
                carfStandard: "2.A.2",
                required: true,
                description: "Understanding addiction and recovery",
            },
            {
                id: "infection-control",
                title: "Infection Control & Bloodborne Pathogens",
                carfStandard: "1.H.12.b",
                required: true,
                description: "Prevent infections and protect clients",
            },
            {
                id: "crisis-intervention",
                title: "Crisis Intervention & De-escalation",
                carfStandard: "2.C.1",
                required: true,
                description: "Safely manage behavioral crises",
            },
            {
                id: "confidentiality",
                title: "Confidentiality & 42 CFR Part 2",
                carfStandard: "1.I.1",
                required: true,
                description: "Substance abuse confidentiality rules",
            },
        ],
        "Peer Support Specialist": [],
        "Clinical Staff": [],
        "Administrative Staff": [],
        "Case Manager": [],
    },
};

export function getSuggestedCourses(
    role: WorkerRole,
    programType: string
): CARFCourse[] {
    const programMapping = CARF_COURSE_MAPPING[programType];
    if (!programMapping) {
        return CARF_COURSE_MAPPING["Behavioral Health"][role] || [];
    }
    return programMapping[role] || [];
}
