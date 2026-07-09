import { NextRequest, NextResponse } from 'next/server';
import { isAdminRole } from '@/lib/rbac/role-utils';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import type { AuditReportResult } from '@/lib/audit-reports/types';

/** Flatten a report result into tabular rows for the CSV/DOCX secondary formats. */
function flattenResult(result: AuditReportResult): Record<string, unknown>[] {
  switch (result.scope) {
    case 'org':
      return result.activity.map((a) => ({
        'Staff Name': a.staffName,
        'Course Title': a.courseTitle,
        Category: a.category ?? '',
        Status: a.status,
        Score: a.score ?? 'N/A',
        'Date Assigned': a.dateAssigned,
        'Date Completed': a.dateCompleted ?? '',
      }));
    case 'staff':
      return result.transcript.map((t) => ({
        'Course Title': t.courseTitle,
        Type: t.type,
        Category: t.category ?? '',
        Status: t.status,
        Score: t.score ?? 'N/A',
        Attempts: t.attempts,
        'Date Assigned': t.dateAssigned,
        'Date Completed': t.dateCompleted ?? '',
      }));
    case 'course':
      return result.staffPerformance.map((s) => ({
        'Course Title': result.course.title,
        'Staff Name': s.staffName,
        Status: s.status,
        Score: s.score ?? 'N/A',
        Attempts: s.attempts,
        'Date Completed': s.completedAt ?? '',
      }));
    case 'all-courses':
      return result.courses.map((c) => ({
        'Course Title': c.courseTitle,
        Category: c.category ?? '',
        Type: c.type,
        Status: c.status,
        'Assigned Staff': c.assignedStaff,
        Completed: c.completed,
        'Completion Rate (%)': c.completionRate,
      }));
    case 'all-staff':
      return result.staff.map((s) => ({
        'Staff Name': s.staffName,
        Role: s.roleLabel,
        Email: s.email,
        'Courses Assigned': s.coursesAssigned,
        'Courses Completed': s.coursesCompleted,
        'Completion Rate (%)': s.completionRate,
        'Last Activity': s.lastActivity ?? '',
      }));
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'pdf';

    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
    }

    // ── Authorization: caller must be an admin of an org with the paid auditor
    //    feature enabled (mirrors POST /api/auditor/export).
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, organizationId: true },
    });
    if (!user || !isAdminRole(user.role) || !user.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { name: true, hasAuditorAccess: true },
    });
    if (!org?.hasAuditorAccess) {
      return NextResponse.json({ error: 'Auditor access not enabled' }, { status: 403 });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'completed') {
      return NextResponse.json({ error: 'Job not ready or not found' }, { status: 404 });
    }

    // Tenant isolation: the job must belong to a user in the caller's org.
    if (job.userId) {
      const jobOwner = await prisma.user.findUnique({
        where: { id: job.userId },
        select: { organizationId: true },
      });
      if (jobOwner?.organizationId !== user.organizationId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (job.result === null || typeof job.result !== 'object') {
      return NextResponse.json({ error: 'Invalid job result formatting' }, { status: 500 });
    }
    const result = job.result as unknown as import('@/lib/audit-reports/types').AuditReportResult;

    // F-001: record the auditor export download (PHI/PII egress) on the
    // authorized path, with scope/format/row-count context (no PII values).
    await audit({
      action: 'export.download',
      actorId: session.user.id,
      actorRole: user.role,
      organizationId: user.organizationId,
      targetType: 'job',
      targetId: jobId,
      metadata: { scope: result.scope, format, rowCount: flattenResult(result).length },
      ...getClientContext(req.headers),
    });

    const orgName = org.name || 'Organization';
    const timestamp = new Date().toISOString().split('T')[0];
    const safeName = orgName.replace(/[^a-z0-9]+/gi, '_');

    if (format === 'pdf') {
      const { generateAuditReportPdf } = await import('@/lib/audit-reports/pdf');
      const pdf = await generateAuditReportPdf(result);
      const scopeLabel =
        result.scope === 'course'
          ? result.course.title.replace(/[^a-z0-9]+/gi, '_')
          : result.scope === 'staff'
            ? result.staff.name.replace(/[^a-z0-9]+/gi, '_')
            : safeName;
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Audit_Report_${result.scope}_${scopeLabel}_${timestamp}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // ── Flatten the result into rows for CSV/DOCX (secondary formats) ──
    const flatRows: Record<string, unknown>[] = flattenResult(result);

    if (format === 'csv') {
      const worksheet = XLSX.utils.json_to_sheet(flatRows);
      const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
      return new NextResponse(csvOutput, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="Audit_Report_${safeName}_${timestamp}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'docx') {
      const children: Paragraph[] = [
        new Paragraph({
          text: `Audit Report: ${orgName}`,
          heading: HeadingLevel.TITLE,
          spacing: { after: 400 },
        }),
      ];
      flatRows.forEach((row) => {
        children.push(
          new Paragraph({
            text: Object.entries(row)
              .map(([k, v]) => `${k}: ${v}`)
              .join('  |  '),
            spacing: { after: 100 },
          }),
        );
      });
      const docxDoc = new Document({ sections: [{ properties: {}, children }] });
      const b64string = await Packer.toBase64String(docxDoc);
      const buffer = Buffer.from(b64string, 'base64');
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="Audit_Report_${safeName}_${timestamp}.docx"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
  } catch (error) {
    logger.error({ msg: 'Failed to download job result:', err: error });
    return NextResponse.json({ error: 'Failed to generate download' }, { status: 500 });
  }
}
