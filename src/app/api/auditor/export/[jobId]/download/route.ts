import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import * as XLSX from 'xlsx';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'csv';

    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'completed') {
      return NextResponse.json({ error: 'Job not ready or not found' }, { status: 404 });
    }

    let compiledData: Record<string, unknown>[] = [];
    if (Array.isArray(job.result)) {
      compiledData = job.result as Record<string, unknown>[];
    } else {
      return NextResponse.json({ error: 'Invalid job result formatting' }, { status: 500 });
    }

    const org = await prisma.organization.findFirst({
      where: { users: { some: { id: session.user.id } } },
    });
    const orgName = org?.name || 'Organization';
    const timestamp = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      // Flatten the compiled data into a 2D array for XLSX
      const rows: Record<string, unknown>[] = [];
      compiledData.forEach((row) => {
        const baseInfo = {
          'Staff Name': row.staffName as string,
          'Course Title': row.courseTitle as string,
          Status: row.status as string,
          Score: row.score ?? 'N/A',
          Attested: row.attested ? 'Yes' : 'No',
          'Attestation Role': (row.attestationRole as string) || 'N/A',
          'Attestation Date': row.attestationDate
            ? new Date(row.attestationDate as string).toLocaleString()
            : 'N/A',
          'Course Summary': row.courseSummary as string,
        };

        const quizzes = row.quizzes as Record<string, unknown>[] | undefined;
        if (!quizzes || quizzes.length === 0) {
          rows.push({ ...baseInfo, 'Quiz Name': 'None', 'Quiz Best Score': 'N/A' });
        } else {
          quizzes.forEach((q) => {
            const attempts = q.attempts as { score: number }[] | undefined;
            const bestScore = attempts ? Math.max(...attempts.map((a) => a.score), 0) : 'N/A';
            rows.push({
              ...baseInfo,
              'Quiz Name': q.title as string,
              'Quiz Best Score': bestScore !== -Infinity ? bestScore : '0',
            });
          });
        }
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const csvOutput = XLSX.utils.sheet_to_csv(worksheet);

      return new NextResponse(csvOutput, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="Auditor_Export_${orgName}_${timestamp}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    } else if (format === 'docx') {
      const children: (Paragraph | Table)[] = [];
      children.push(
        new Paragraph({
          text: `Auditor Compliance Pack: ${orgName}`,
          heading: HeadingLevel.TITLE,
          spacing: { after: 400 },
        }),
      );

      // Build text paragraphs for docx
      compiledData.forEach((row) => {
        children.push(
          new Paragraph({
            text: `Staff: ${row.staffName as string}`,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }),
        );
        children.push(
          new Paragraph({
            text: `Course: ${row.courseTitle as string}`,
            heading: HeadingLevel.HEADING_2,
            spacing: { after: 100 },
          }),
        );
        children.push(
          new Paragraph({
            text: `Status: ${row.status as string} | Score: ${row.score ?? 'N/A'} | Attested: ${row.attested ? 'Yes' : 'No'} (${row.attestationRole as string})`,
            spacing: { after: 100 },
          }),
        );
        children.push(
          new Paragraph({
            text: `Summary: ${row.courseSummary as string}`,
            spacing: { after: 200 },
          }),
        );

        const quizzes = row.quizzes as Record<string, unknown>[] | undefined;
        if (quizzes && quizzes.length > 0) {
          quizzes.forEach((q) => {
            children.push(
              new Paragraph({
                text: `Quiz: ${q.title as string} (Passing Score: ${q.passingScore ?? '70'}%)`,
                heading: HeadingLevel.HEADING_3,
              }),
            );
            const questions = q.questions as Record<string, unknown>[] | undefined;
            if (questions) {
              questions.forEach((qu, i: number) => {
                children.push(new Paragraph({ text: `Q${i + 1}: ${qu.text as string}` }));
                if (Array.isArray(qu.options)) {
                  children.push(
                    new Paragraph({ text: `   Options: ${(qu.options as string[]).join(', ')}` }),
                  );
                }
                children.push(
                  new Paragraph({
                    text: `   Answer: ${qu.correctAnswer as string}`,
                    spacing: { after: 100 },
                  }),
                );
              });
            }
          });
        }
      });

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: children,
          },
        ],
      });

      const b64string = await Packer.toBase64String(doc);
      const buffer = Buffer.from(b64string, 'base64');

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="Auditor_Export_${orgName}_${timestamp}.docx"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
  } catch (error) {
    console.error('Failed to download job result:', error);
    return NextResponse.json({ error: 'Failed to generate download' }, { status: 500 });
  }
}
