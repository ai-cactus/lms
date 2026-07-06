import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanText } from './phiScanner';
import { callVertexAI } from '@/lib/ai-client';

vi.mock('@/lib/ai-client', () => ({
  callVertexAI: vi.fn(),
}));

describe('phiScanner', () => {
  const mockedCallVertexAI = vi.mocked(callVertexAI);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation to return no findings
    mockedCallVertexAI.mockResolvedValue('{"hasPHI": false, "findings": []}');
  });

  it('should return no PHI and not call AI if text is shorter than 50 characters', async () => {
    const text = 'Short text';
    const result = await scanText(text);

    expect(result).toEqual({ hasPHI: false, findings: [] });
    expect(mockedCallVertexAI).not.toHaveBeenCalled();
  });

  it('should call AI and process if text is exactly 50 characters', async () => {
    // 50 characters string
    const text = '1234567890'.repeat(5);

    await scanText(text);

    expect(mockedCallVertexAI).toHaveBeenCalledTimes(1);
    expect(mockedCallVertexAI).toHaveBeenCalledWith(
      expect.stringContaining(text),
      expect.any(Object),
    );
  });

  it('should return PHI findings if AI detects them', async () => {
    const text = 'Patient John Doe (DOB 01/01/1980) visited today.'.padEnd(50, ' ');
    mockedCallVertexAI.mockResolvedValue(
      JSON.stringify({
        hasPHI: true,
        findings: [
          { type: 'NAME', value: 'John Doe', confidence: 0.95 },
          { type: 'DATE', value: '01/01/1980', confidence: 0.99 },
        ],
      }),
    );

    const result = await scanText(text);

    expect(result.hasPHI).toBe(true);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({ type: 'NAME', value: 'John Doe', confidence: 0.95 });
    expect(result.findings[1]).toMatchObject({
      type: 'DATE',
      value: '01/01/1980',
      confidence: 0.99,
    });
  });

  it('should return no PHI if AI returns no findings', async () => {
    const text = 'The weather is very nice today in New York City.'.padEnd(50, ' ');
    mockedCallVertexAI.mockResolvedValue(
      JSON.stringify({
        hasPHI: false,
        findings: [],
      }),
    );

    const result = await scanText(text);

    expect(result).toEqual({ hasPHI: false, findings: [] });
  });

  // THER-003: the scanner now ALWAYS fails closed — a scan that could not be
  // completed (no JSON, malformed JSON, unexpected structure, thrown error)
  // is treated as blocked/unverified (hasPHI: true, scanFailed: true), never
  // silently passed through as PHI-free. This is a behavior change from the
  // old fail-open-unless-PHI_FAIL_CLOSED default; these three tests replace
  // the previous fail-open expectations.
  it('fails CLOSED (blocked, scanFailed) when the AI response has no JSON block', async () => {
    const text = 'Some longer text that should be scanned.'.padEnd(50, ' ');
    mockedCallVertexAI.mockResolvedValue(
      'I am an AI and I think this text has PHI, but I forgot to output JSON.',
    );

    const result = await scanText(text);

    expect(result.hasPHI).toBe(true);
    expect(result.scanFailed).toBe(true);
  });

  it('fails CLOSED (blocked, scanFailed) when the AI JSON response has unexpected structure', async () => {
    const text = 'Some longer text that should be scanned.'.padEnd(50, ' ');
    mockedCallVertexAI.mockResolvedValue('```json\n{"wrongField": true}\n```');

    const result = await scanText(text);

    expect(result.hasPHI).toBe(true);
    expect(result.scanFailed).toBe(true);
  });

  it('fails CLOSED (blocked, scanFailed) when the AI API call throws — never silently lets a document through', async () => {
    const text = 'Some longer text that should be scanned.'.padEnd(50, ' ');
    mockedCallVertexAI.mockRejectedValue(new Error('Vertex AI rate limit exceeded'));

    const result = await scanText(text);

    expect(result.hasPHI).toBe(true);
    expect(result.scanFailed).toBe(true);
  });

  it('fails CLOSED when the AI returns malformed (unparseable) JSON', async () => {
    const text = 'Some longer text that should be scanned.'.padEnd(50, ' ');
    mockedCallVertexAI.mockResolvedValue('```json\n{ this is not valid json \n```');

    const result = await scanText(text);

    expect(result.hasPHI).toBe(true);
    expect(result.scanFailed).toBe(true);
  });

  it('a genuine PHI detection is NOT flagged as scanFailed (distinct from a failed scan)', async () => {
    const text = 'Patient John Doe (DOB 01/01/1980) visited today.'.padEnd(50, ' ');
    mockedCallVertexAI.mockResolvedValue(
      JSON.stringify({
        hasPHI: true,
        findings: [{ type: 'NAME', value: 'John Doe', confidence: 0.95 }],
      }),
    );

    const result = await scanText(text);

    expect(result.hasPHI).toBe(true);
    expect(result.scanFailed).toBeUndefined();
  });

  it('should truncate text to 15000 characters before calling AI', async () => {
    const longText = 'A'.repeat(20000);
    const expectedTruncatedText = 'A'.repeat(15000);

    await scanText(longText);

    expect(mockedCallVertexAI).toHaveBeenCalledTimes(1);
    expect(mockedCallVertexAI).toHaveBeenCalledWith(
      expect.stringContaining(expectedTruncatedText),
      expect.any(Object),
    );
    // Ensure the prompt does not contain the full text
    expect(mockedCallVertexAI).not.toHaveBeenCalledWith(
      expect.stringContaining(longText),
      expect.any(Object),
    );
  });
});
