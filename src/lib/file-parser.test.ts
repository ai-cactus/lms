import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractTextFromFile } from './file-parser';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

// Mock dependencies
vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn()
  }
}));

vi.mock('pdf-parse', () => {
  return {
    PDFParse: Object.assign(
      vi.fn().mockImplementation(() => ({
        getText: vi.fn()
      })),
      {
        setWorker: vi.fn()
      }
    )
  };
});

// Minimal polyfill/mock for File
class MockFile {
  name: string;
  type: string;
  buffer: ArrayBuffer;

  constructor(parts: unknown[], name: string, options: { type: string }) {
    this.name = name;
    this.type = options.type;
    // Create a dummy ArrayBuffer from the parts for testing
    const text = parts.join('');
    const encoder = new TextEncoder();
    this.buffer = encoder.encode(text).buffer;
  }

  async arrayBuffer() {
    return this.buffer;
  }
}

describe('extractTextFromFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully extract text from a PDF file', async () => {
    const mockPdfText = 'Hello PDF world!';
    // Mock the PDFParse instance
    const mockGetText = vi.fn().mockResolvedValue({ text: mockPdfText });
    vi.mocked(PDFParse).mockImplementationOnce(() => ({
      getText: mockGetText,
    } as unknown as PDFParse));

    const file = new MockFile(['dummy content'], 'test.pdf', { type: 'application/pdf' });
    const result = await extractTextFromFile(file as unknown as File);

    expect(PDFParse.setWorker).toHaveBeenCalled();
    expect(PDFParse).toHaveBeenCalled();
    expect(mockGetText).toHaveBeenCalled();
    expect(result).toBe(mockPdfText);
  });

  it('should successfully extract text from a DOCX file by MIME type', async () => {
    const mockDocxText = 'Hello DOCX world!';
    vi.mocked(mammoth.extractRawText).mockResolvedValueOnce({ value: mockDocxText, messages: [] });

    const file = new MockFile(['dummy content'], 'test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    const result = await extractTextFromFile(file as unknown as File);

    expect(mammoth.extractRawText).toHaveBeenCalled();
    expect(result).toBe(mockDocxText);
  });

  it('should successfully extract text from a DOCX file by extension fallback', async () => {
    const mockDocxText = 'Fallback DOCX text';
    vi.mocked(mammoth.extractRawText).mockResolvedValueOnce({ value: mockDocxText, messages: [] });

    // Provide a file with a generic type but .docx extension
    const file = new MockFile(['dummy content'], 'test.docx', { type: 'application/octet-stream' });

    const result = await extractTextFromFile(file as unknown as File);

    expect(mammoth.extractRawText).toHaveBeenCalled();
    expect(result).toBe(mockDocxText);
  });

  it('should handle PDF extraction returning an empty string', async () => {
    const mockGetText = vi.fn().mockResolvedValue({ text: '   ' }); // Only whitespace
    vi.mocked(PDFParse).mockImplementationOnce(() => ({
      getText: mockGetText,
    } as unknown as PDFParse));

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const file = new MockFile(['dummy content'], 'empty.pdf', { type: 'application/pdf' });
    const result = await extractTextFromFile(file as unknown as File);

    expect(result).toBe(''); // The function trims the text
    expect(consoleWarnSpy).toHaveBeenCalledWith('PDF parsing returned empty string.');

    consoleWarnSpy.mockRestore();
  });

  it('should handle PDF parsing errors', async () => {
    const errorMessage = 'Mocked PDF Error';
    const mockGetText = vi.fn().mockRejectedValue(new Error(errorMessage));
    vi.mocked(PDFParse).mockImplementationOnce(() => ({
      getText: mockGetText,
    } as unknown as PDFParse));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const file = new MockFile(['dummy content'], 'error.pdf', { type: 'application/pdf' });

    await expect(extractTextFromFile(file as unknown as File)).rejects.toThrow(
      `PDF Parsing Failed: ${errorMessage}`
    );

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('should throw an error for unsupported file types', async () => {
    const file = new MockFile(['dummy content'], 'image.png', { type: 'image/png' });

    await expect(extractTextFromFile(file as unknown as File)).rejects.toThrow(
      'Unsupported file type. Please upload a PDF or DOCX file.'
    );
  });
});