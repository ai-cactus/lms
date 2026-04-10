import { callVertexAI } from '@/lib/ai-client';
import { logger } from '@/lib/logger';

const PHI_FAIL_CLOSED = process.env.PHI_FAIL_CLOSED === 'true';

export type PHIFinding = {
  type: 'DATE' | 'EMAIL' | 'PHONE' | 'SSN' | 'ZIP' | 'NAME' | 'ADDRESS' | 'OTHER';
  value: string;
  index: number;
  confidence?: number;
};

export type ScanResult = {
  hasPHI: boolean;
  findings: PHIFinding[];
};

export async function scanText(text: string): Promise<ScanResult> {
  // Quick heuristic: If text is very short (< 50 chars), skip AI to save cost/time
  if (text.length < 50) return { hasPHI: false, findings: [] };

  // Truncate for analysis if needed (though we want to scan mostly everything,
  // maybe scan first 20k chars as a representative sample or split chunks?
  // For MVP, taking first 15k characters is a reasonable trade-off).
  const contentToScan = text.slice(0, 15000);

  const prompt = `
        You are an expert compliance officer. Analyze the following text for Protected Health Information (PHI) and Personally Identifiable Information (PII).
        
        Look for:
        - Full Names of patients/clients (ignore public figures or generic names if context isn't medical/records)
        - Social Security Numbers (SSN)
        - Dates (birth dates, admission dates, discharge dates)
        - Phone numbers
        - Email addresses
        - Full addresses
        - Medical Record Numbers (MRN)
        
        TEXT TO ANALYZE:
        """
        ${contentToScan}
        """
        
        Return a JSON object with a boolean field "hasPHI" and an array "findings".
        Each finding should have: "type" (enum: NAME, SSN, DATE, PHONE, EMAIL, ADDRESS, OTHER), "value" (the exact text string), and "confidence" (0-1).
        Only include findings with high confidence (> 0.8) that appear to be real personal data, not generic placeholders.
    `;

  try {
    const aiResponse = await callVertexAI(prompt, { temperature: 0.1 });

    // JSON extraction
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('PHI Scanner: No JSON found in response');
      return { hasPHI: false, findings: [] };
    }

    const data = JSON.parse(jsonMatch[0]);

    // Validate structure vaguely
    if (typeof data.hasPHI === 'boolean' && Array.isArray(data.findings)) {
      return {
        hasPHI: data.hasPHI,
        findings: (data.findings as Record<string, unknown>[]).map((f) => ({
          type: (f.type || 'OTHER') as PHIFinding['type'],
          value: (f.value as string) || '',
          index: 0, // AI doesn't give index easily without more complex logic, defaulting to 0
          confidence: f.confidence as number | undefined,
        })),
      };
    }

    return { hasPHI: false, findings: [] };
  } catch (error) {
    logger.error({ msg: 'PHI scan failed', error: String(error) });

    if (PHI_FAIL_CLOSED) {
      // Fail closed: treat scan failure as potential PHI presence
      logger.warn({ msg: 'PHI scanner fail-closed: blocking document' });
      return {
        hasPHI: true,
        findings: [
          {
            type: 'OTHER',
            value: 'PHI scan failed — document blocked as precaution',
            index: 0,
            confidence: 1.0,
          },
        ],
      };
    }

    // Fail open (legacy behavior) — log warning for monitoring
    logger.warn({ msg: 'PHI scanner fail-open: allowing document through' });
    return { hasPHI: false, findings: [] };
  }
}
