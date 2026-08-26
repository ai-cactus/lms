/**
 * Render QA Markdown reports to DOCX.
 *
 *   node scripts/render-qa-report-docx.mjs qa-reports/2026-08-24-rbac-conflicts.md
 *   node scripts/render-qa-report-docx.mjs qa-reports/2026-08-20
 *
 * Writes a sibling .docx for each .md. Re-running overwrites.
 *
 * Companion to render-qa-report.mjs (PDF). That one goes Markdown -> HTML ->
 * Chromium page.pdf(); this one builds the OOXML tree directly with `docx`,
 * which is already a declared dependency. pandoc and libreoffice are absent in
 * this environment, so an HTML intermediate would have nothing to consume it.
 *
 * The Markdown subset matches render-qa-report.mjs deliberately — headings,
 * tables, lists, fenced code, blockquotes, rules, links, bold and inline code.
 * It is a report renderer, not a general CommonMark implementation.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from 'docx';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MONO = 'Consolas';
const BODY = 'Calibri';
const ACCENT = '1F3864';
const RULE = 'BFBFBF';
const CODE_BG = 'F2F2F2';

/**
 * Split one line of Markdown into docx runs. Handles `code`, **bold** and
 * [text](url). Order matters: code is tokenised first so bold markers inside a
 * code span are not treated as emphasis.
 */
function runs(text, { bold = false, size = 20, color } = {}) {
  const out = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) {
      out.push(new TextRun({ text: text.slice(last, m.index), bold, size, font: BODY, color }));
    }
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        new TextRun({
          text: tok.slice(1, -1),
          font: MONO,
          size: size - 2,
          bold,
          color: 'A31515',
        }),
      );
    } else if (tok.startsWith('**')) {
      out.push(new TextRun({ text: tok.slice(2, -2), bold: true, size, font: BODY, color }));
    } else {
      const label = tok.slice(1, tok.indexOf(']'));
      const url = tok.slice(tok.indexOf('(') + 1, -1);
      out.push(
        new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: label, style: 'Hyperlink', size, font: BODY })],
        }),
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) {
    out.push(new TextRun({ text: text.slice(last), bold, size, font: BODY, color }));
  }
  return out.length ? out : [new TextRun({ text: '', size, font: BODY })];
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

function tableCell(text, { header = false } = {}) {
  return new TableCell({
    width: { size: 100, type: WidthType.AUTO },
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7E6E6' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [
      new Paragraph({
        spacing: { before: 20, after: 20 },
        children: runs(text, { bold: header, size: 17 }),
      }),
    ],
  });
}

export function mdToDocxChildren(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    if (/^```/.test(line)) {
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      for (const c of buf) {
        out.push(
          new Paragraph({
            spacing: { before: 0, after: 0 },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: CODE_BG },
            children: [new TextRun({ text: c || ' ', font: MONO, size: 17 })],
          }),
        );
      }
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      out.push(
        new Paragraph({
          spacing: { before: 160, after: 160 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } },
          children: [],
        }),
      );
      i++;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(
        new Paragraph({
          heading:
            level === 1
              ? HeadingLevel.TITLE
              : level === 2
                ? HeadingLevel.HEADING_1
                : level === 3
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3,
          spacing: { before: level <= 2 ? 260 : 180, after: 100 },
          children: runs(h[2], {
            bold: true,
            size: level === 1 ? 34 : level === 2 ? 26 : 22,
            color: ACCENT,
          }),
        }),
      );
      i++;
      continue;
    }

    // Table: header row, delimiter row, then body until a non-pipe line
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(cells(lines[i++]));
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
            bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
            left: { style: BorderStyle.SINGLE, size: 2, color: RULE },
            right: { style: BorderStyle.SINGLE, size: 2, color: RULE },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
            insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
          },
          rows: [
            new TableRow({
              tableHeader: true,
              children: header.map((c) => tableCell(c, { header: true })),
            }),
            ...body.map(
              (r) =>
                new TableRow({
                  children: header.map((_, idx) => tableCell(r[idx] ?? '')),
                }),
            ),
          ],
        }),
      );
      out.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(
        new Paragraph({
          spacing: { before: 120, after: 140 },
          indent: { left: 340 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 12 } },
          children: runs(buf.join(' '), { size: 20, color: '444444' }),
        }),
      );
      continue;
    }

    // List item (bullet or ordered), with hanging continuation lines
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bullet || ordered) {
      let text = (bullet || ordered)[1];
      while (
        i + 1 < lines.length &&
        /^\s{2,}\S/.test(lines[i + 1]) &&
        !/^\s*[-*\d]/.test(lines[i + 1])
      ) {
        text += ' ' + lines[++i].trim();
      }
      out.push(
        new Paragraph({
          bullet: bullet ? { level: 0 } : undefined,
          numbering: undefined,
          indent: ordered ? { left: 460, hanging: 220 } : undefined,
          spacing: { before: 30, after: 30 },
          children: ordered
            ? runs(`${line.trim().match(/^\d+/)[0]}.  ${text}`, { size: 20 })
            : runs(text, { size: 20 }),
        }),
      );
      i++;
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: gather until a blank line or the start of another block
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|>|```|\s*\||\s*[-*]\s|\s*\d+\.\s|---)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    out.push(
      new Paragraph({
        spacing: { before: 60, after: 120 },
        children: runs(para.join(' '), { size: 20 }),
      }),
    );
  }

  return out;
}

function collect(targets) {
  const files = [];
  for (const t of targets) {
    const p = resolve(t);
    if (statSync(p).isDirectory()) {
      readdirSync(p)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .sort()
        .forEach((f) => files.push(join(p, f)));
    } else {
      files.push(p);
    }
  }
  return files;
}

const isCli = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
const targets = isCli ? process.argv.slice(2) : [];

if (isCli) {
  if (targets.length === 0) {
    console.error('Usage: node scripts/render-qa-report-docx.mjs <file.md | directory> [...]');
    process.exit(1);
  }
  const files = collect(targets);
  if (files.length === 0) {
    console.error('No .md files found (README.md is skipped when scanning a directory).');
    process.exit(1);
  }

  let failed = 0;
  for (const file of files) {
    try {
      const md = readFileSync(file, 'utf8');
      const doc = new Document({
        creator: 'Theraptly QA',
        title: basename(file, '.md'),
        styles: {
          default: {
            document: { run: { font: BODY, size: 20 } },
          },
        },
        sections: [
          {
            properties: {
              page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } },
            },
            children: mdToDocxChildren(md),
          },
        ],
      });
      const buf = await Packer.toBuffer(doc);
      const outPath = join(dirname(file), `${basename(file, '.md')}.docx`);
      writeFileSync(outPath, buf);
      console.log(`  ok  ${basename(outPath)}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${basename(file)} — ${err.message}`);
    }
  }
  console.log(`\n${files.length - failed}/${files.length} rendered.`);
  if (failed) process.exit(1);
}
