/**
 * Tier 3 item 5.2 (perf/tier3-app-optimization): `exportCertificatePdf`
 * switched `toPng`/`jsPDF` from static imports to
 * `await Promise.all([import('html-to-image'), import('jspdf')])` inside the
 * function body, deferring both libraries until a certificate is actually
 * exported. No test file previously existed for this module.
 *
 * `html-to-image` and `jspdf` are mocked — `toPng` needs a real <canvas> (not
 * available in jsdom) and jsPDF's binary PDF assembly is implementation detail
 * we don't need to re-verify; what matters here is that the dynamic-import
 * wiring still calls them with the same arguments and propagates their
 * failures the same way a static import would have.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockToPng = vi.fn();
const mockSave = vi.fn();
const mockAddImage = vi.fn();
const mockAddPage = vi.fn();
const mockJsPDFCtor = vi.fn();

vi.mock('html-to-image', () => ({ toPng: mockToPng }));
vi.mock('jspdf', () => ({ jsPDF: mockJsPDFCtor }));

import {
  exportCertificatePdf,
  exportCertificatesPdf,
  formatCertificateIssueDate,
  generateQrDataUrl,
} from './certificate-export';

const DATA_URL = 'data:image/png;base64,xyz';

beforeEach(() => {
  vi.clearAllMocks();
  mockToPng.mockResolvedValue(DATA_URL);
  mockJsPDFCtor.mockImplementation(function (this: {
    internal: unknown;
    addImage: typeof mockAddImage;
    addPage: typeof mockAddPage;
    save: typeof mockSave;
  }) {
    this.internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    this.addImage = mockAddImage;
    this.addPage = mockAddPage;
    this.save = mockSave;
  });
});

function makeCertNode(width = 1123, height = 794): HTMLElement {
  const node = document.createElement('div');
  Object.defineProperty(node, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  return node;
}

describe('exportCertificatePdf — dynamic html-to-image/jspdf import', () => {
  it('rasterises the certificate node at its measured size and builds a landscape A4 PDF', async () => {
    const node = makeCertNode(1123, 794);

    await exportCertificatePdf(node, 'Certificate-Course-Jane Doe');

    expect(mockToPng).toHaveBeenCalledWith(
      node,
      expect.objectContaining({
        pixelRatio: 2,
        width: 1123,
        height: 794,
        cacheBust: true,
        backgroundColor: '#F6F5F0',
      }),
    );
    expect(mockJsPDFCtor).toHaveBeenCalledWith({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });
    expect(mockAddImage).toHaveBeenCalledWith(DATA_URL, 'PNG', 0, 0, 297, 210, undefined, 'FAST');
  });

  it('sanitizes the filename before saving, matching the pre-change contract', async () => {
    const node = makeCertNode();

    await exportCertificatePdf(node, 'Certificate: Advanced Care / Jane Doe!!');

    expect(mockSave).toHaveBeenCalledWith('Certificate-Advanced-Care-Jane-Doe.pdf');
  });

  it('falls back to a generic filename when the name sanitizes to nothing', async () => {
    const node = makeCertNode();

    await exportCertificatePdf(node, '###');

    expect(mockSave).toHaveBeenCalledWith('certificate.pdf');
  });

  it('propagates a toPng (html-to-image) failure instead of swallowing it', async () => {
    mockToPng.mockRejectedValue(new Error('canvas capture failed'));
    const node = makeCertNode();

    await expect(exportCertificatePdf(node, 'x')).rejects.toThrow('canvas capture failed');
    expect(mockJsPDFCtor).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('propagates a jsPDF construction failure instead of swallowing it', async () => {
    mockJsPDFCtor.mockImplementation(() => {
      throw new Error('jsPDF init failed');
    });
    const node = makeCertNode();

    await expect(exportCertificatePdf(node, 'x')).rejects.toThrow('jsPDF init failed');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('awaits document.fonts.ready before capturing, when available', async () => {
    let fontsReadyResolved = false;
    const fontsReady = Promise.resolve().then(() => {
      fontsReadyResolved = true;
    });
    Object.defineProperty(document, 'fonts', {
      value: { ready: fontsReady },
      configurable: true,
    });

    const node = makeCertNode();
    await exportCertificatePdf(node, 'x');

    expect(fontsReadyResolved).toBe(true);
    // @ts-expect-error -- test cleanup of a jsdom-only stub
    delete document.fonts;
  });
});

describe('generateQrDataUrl', () => {
  it('produces a PNG data URL for the given verification value', async () => {
    const dataUrl = await generateQrDataUrl('https://example.com/verify-certificate/abc123');

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

/**
 * "Export All" on the learner's certificates page used to download a CSV table
 * of certificate ids. It now produces one multi-page PDF carrying the designed
 * certificate, so these pin the contract the CSV never had: every certificate
 * gets a page, page 1 is not the blank page jsPDF opens with, and a failure
 * mid-way never saves a short file.
 */
describe('exportCertificatesPdf — multi-page bulk export', () => {
  it('draws one page per certificate without leaving jsPDF’s opening page blank', async () => {
    const nodes = [makeCertNode(), makeCertNode(), makeCertNode()];

    await exportCertificatesPdf(nodes, 'certificates');

    expect(mockToPng).toHaveBeenCalledTimes(3);
    expect(mockAddImage).toHaveBeenCalledTimes(3);
    // Three certificates, but only two added pages — the first fills the page
    // the document already opened with.
    expect(mockAddPage).toHaveBeenCalledTimes(2);
    expect(mockAddPage).toHaveBeenCalledWith('a4', 'landscape');
    expect(mockJsPDFCtor).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith('certificates.pdf');
  });

  it('rasterises the nodes one at a time, in the order given', async () => {
    const nodes = [makeCertNode(), makeCertNode(), makeCertNode()];
    let inFlight = 0;
    let maxInFlight = 0;
    const captured: HTMLElement[] = [];
    mockToPng.mockImplementation(async (node: HTMLElement) => {
      captured.push(node);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return DATA_URL;
    });

    await exportCertificatesPdf(nodes, 'certificates');

    expect(maxInFlight).toBe(1);
    expect(captured).toEqual(nodes);
  });

  it('refuses an empty selection rather than downloading a blank PDF', async () => {
    await expect(exportCertificatesPdf([], 'certificates')).rejects.toThrow(
      'No certificates to export',
    );

    expect(mockJsPDFCtor).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('propagates a mid-list capture failure instead of saving a short PDF', async () => {
    mockToPng.mockResolvedValueOnce(DATA_URL).mockRejectedValueOnce(new Error('capture failed'));

    await expect(
      exportCertificatesPdf([makeCertNode(), makeCertNode(), makeCertNode()], 'certificates'),
    ).rejects.toThrow('capture failed');

    expect(mockSave).not.toHaveBeenCalled();
  });

  it('sanitizes the filename the same way the single export does', async () => {
    await exportCertificatesPdf([makeCertNode()], 'My Certificates: 2026!');

    expect(mockSave).toHaveBeenCalledWith('My-Certificates-2026.pdf');
  });
});

describe('formatCertificateIssueDate', () => {
  // Shared by the preview modal and every exported page so the same
  // certificate cannot show two different dates.
  it('formats the issue date exactly as the certificate artwork shows it', () => {
    expect(formatCertificateIssueDate('2026-01-15T12:00:00Z')).toBe('15 Jan 2026');
    expect(formatCertificateIssueDate(new Date('2026-10-02T00:00:00Z'))).toBe('02 Oct 2026');
  });
});
