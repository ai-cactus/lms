import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanText } from './phiScanner';
import { callVertexAI } from '@/lib/ai-client';

// Mock the AI client
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

  it('should handle malformed JSON from AI gracefully', async () => {
    const text = 'Some longer text that should be scanned.'.padEnd(50, ' ');
    mockedCallVertexAI.mockResolvedValue(
      'I am an AI and I think this text has PHI, but I forgot to output JSON.',
    );

    const result = await scanText(text);

    expect(result).toEqual({ hasPHI: false, findings: [] });
  });

  it('should handle missing fields in AI JSON response gracefully', async () => {
    const text = 'Some longer text that should be scanned.'.padEnd(50, ' ');
    mockedCallVertexAI.mockResolvedValue('```json\n{"wrongField": true}\n```');

    const result = await scanText(text);

    expect(result).toEqual({ hasPHI: false, findings: [] });
  });

  it('should return no PHI if the AI API call throws an error', async () => {
    const text = 'Some longer text that should be scanned.'.padEnd(50, ' ');
    mockedCallVertexAI.mockRejectedValue(new Error('Vertex AI rate limit exceeded'));

    const result = await scanText(text);

    expect(result).toEqual({ hasPHI: false, findings: [] });
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
