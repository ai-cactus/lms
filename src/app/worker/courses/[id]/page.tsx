
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function WorkerCourseDetailsPage(props: PageProps) {
    const params = await props.params;
    // Redirect workers directly to the immersive slide/learner view
    redirect(`/learn/${params.id}`);
}
