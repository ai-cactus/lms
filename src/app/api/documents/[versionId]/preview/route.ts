import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getDocumentSignedUrl } from '@/app/actions/storage';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { versionId } = await params;

  // Verify ownership
  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: { document: true },
  });

  if (!version || version.document.userId !== session.user.id) {
    return new Response('Not found', { status: 404 });
  }

  const { url, error } = await getDocumentSignedUrl(versionId);
  if (error || !url) {
    return new Response(error || 'Failed to get URL', { status: 500 });
  }

  // If local path or unsupported format, handle gracefully or return 400
  if (!url.startsWith('http')) {
    return new Response('Local files must be served differently', { status: 400 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return new Response('Failed to fetch document from storage', { status: response.status });
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': version.document.mimeType,
        'Content-Disposition': `inline; filename="${version.document.filename}"`,
      },
    });
  } catch (err: unknown) {
    const e = err as Error;
    return new Response(`Error proxying document: ${e.message}`, { status: 500 });
  }
}
