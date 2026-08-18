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
const mockJsPDFCtor = vi.fn();

vi.mock('html-to-image', () => ({ toPng: mockToPng }));
vi.mock('jspdf', () => ({ jsPDF: mockJsPDFCtor }));

import { exportCertificatePdf, generateQrDataUrl } from './certificate-export';

const DATA_URL = 'data:image/png;base64,xyz';

beforeEach(() => {
  vi.clearAllMocks();
  mockToPng.mockResolvedValue(DATA_URL);
  mockJsPDFCtor.mockImplementation(function (this: {
    internal: unknown;
    addImage: typeof mockAddImage;
    save: typeof mockSave;
  }) {
    this.internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    this.addImage = mockAddImage;
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
