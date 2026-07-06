import { callVertexAI } from '@/lib/ai-client';
import { logger } from '@/lib/logger';

export type PHIFinding = {
  type: 'DATE' | 'EMAIL' | 'PHONE' | 'SSN' | 'ZIP' | 'NAME' | 'ADDRESS' | 'OTHER';
  value: string;
  index: number;
  confidence?: number;
};

export type ScanResult = {
  hasPHI: boolean;
  findings: PHIFinding[];
  /**
   * True when the scan could not be completed (AI error / malformed response)
   * and the document was blocked as a precaution rather than because PHI was
   * actually detected. Lets callers show a "couldn't verify" message that is
   * distinct from a genuine PHI detection.
   */
  scanFailed?: boolean;
};

const failClosedResult: ScanResult = {
  hasPHI: true,
  scanFailed: true,
  findings: [
    {
      type: 'OTHER',
      value: 'PHI scan failed — document blocked as precaution',
      index: 0,
      confidence: 1.0,
    },
  ],
};

// Compliance product: if we cannot verify a document is PHI-free, we block it
// (fail-closed) rather than silently letting it through.
function failClosed(reason: string): ScanResult {
  logger.warn({ msg: `[doc] PHI scanner fail-closed: ${reason}` });
  return failClosedResult;
}

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

    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return failClosed('no JSON found in AI response');
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(jsonMatch[0]);
    } catch {
      return failClosed('AI returned malformed JSON');
    }

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

    return failClosed('AI response had unexpected structure');
  } catch (error) {
    logger.error({ msg: 'PHI scan failed', err: String(error) });
    return failClosed('scan exception — blocking document');
  }
}
