export type PHIFinding = {
    type: 'DATE' | 'EMAIL' | 'PHONE' | 'SSN' | 'ZIP';
    value: string;
    index: number;
};

export type ScanResult = {
    hasPHI: boolean;
    findings: PHIFinding[];
};

// Simple regex patterns for common PHI/PII
const PATTERNS: Record<string, RegExp> = {
    DATE: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    EMAIL: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    PHONE: /\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/g,
    SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
    ZIP: /\b\d{5}(?:-\d{4})?\b/g,
};

export async function scanText(text: string): Promise<ScanResult> {
    const findings: PHIFinding[] = [];

    for (const [type, regex] of Object.entries(PATTERNS)) {
        let match;
        // Reset lastIndex for global regexes
        regex.lastIndex = 0;

        while ((match = regex.exec(text)) !== null) {
            findings.push({
                type: type as PHIFinding['type'],
                value: match[0],
                index: match.index,
            });
        }
    }

    return {
        hasPHI: findings.length > 0,
        findings,
    };
}
