import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractTextFromFile } from './file-parser';
import mammoth from 'mammoth';

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

vi.mock('pdf-parse', () => ({
  default: mockPDFParse,
}));

const { mockPDFParse } = vi.hoisted(() => ({
  mockPDFParse: vi.fn().mockResolvedValue({ text: '' }),
}));

// Polyfill File for Node.js environment
class MockFile {
  name: string;
  type: string;
  buffer: Buffer;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(parts: any[], name: string, options: { type: string }) {
    this.name = name;
    this.type = options.type;
    this.buffer = Buffer.from(parts[0]);
  }

  async arrayBuffer() {
    return this.buffer.buffer.slice(
      this.buffer.byteOffset,
      this.buffer.byteOffset + this.buffer.byteLength,
    );
  }
}

describe('extractTextFromFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract text from a valid PDF file', async () => {
    const mockText = 'Hello PDF world';
    const mockFile = new MockFile(['fake-pdf-content'], 'test.pdf', {
      type: 'application/pdf',
    });

    mockPDFParse.mockResolvedValueOnce({ text: mockText });

    const result = await extractTextFromFile(mockFile as unknown as File);
    expect(result).toBe(mockText);
    expect(mockPDFParse).toHaveBeenCalled();
  });

  it('should extract text from a valid DOCX file', async () => {
    const mockText = 'Hello DOCX world';
    const mockFile = new MockFile(['fake-docx-content'], 'test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    vi.mocked(mammoth.extractRawText).mockResolvedValueOnce({
      value: mockText,
      messages: [],
    });

    const result = await extractTextFromFile(mockFile as unknown as File);
    expect(result).toBe(mockText);
    expect(mammoth.extractRawText).toHaveBeenCalled();
  });

  it('should throw an error if PDF parsing fails', async () => {
    const mockFile = new MockFile(['fake-pdf-content'], 'test.pdf', {
      type: 'application/pdf',
    });

    const errorMessage = 'Simulated PDF error';
    mockPDFParse.mockRejectedValueOnce(new Error(errorMessage));

    await expect(extractTextFromFile(mockFile as unknown as File)).rejects.toThrow(
      `PDF Parsing Failed: ${errorMessage}`,
    );
  });

  it('should throw an error for unsupported file types', async () => {
    const mockFile = new MockFile(['fake-txt-content'], 'test.txt', {
      type: 'text/plain',
    });

    await expect(extractTextFromFile(mockFile as unknown as File)).rejects.toThrow(
      'Unsupported file type. Please upload a PDF or DOCX file.',
    );
  });
});
