import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function ProfileRedirectPage() {
    const session = await auth();

    if (!session?.user) {
        redirect('/login');
    }

    const role = session.user.role;

    if (role === 'worker') {
        redirect('/worker/profile');
    } else {
        // Admin, Manager, Supervisor go to dashboard profile
        redirect('/dashboard/profile');
    }
}
