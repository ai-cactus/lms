'use server';

import { signIn } from '@/auth.worker';
import { AuthError } from 'next-auth';

export type AuthState = {
    error?: string;
    success?: boolean;
};

export async function authenticateWorker(prevState: AuthState | undefined, formData: FormData): Promise<AuthState> {
    try {
        await signIn('credentials', {
            ...Object.fromEntries(formData),
            redirectTo: '/worker',
        });
        return { success: true };
    } catch (error) {
        if (error instanceof AuthError) {
            switch (error.type) {
                case 'CredentialsSignin':
                    return { error: 'Invalid worker credentials.' };
                default:
                    return { error: 'Something went wrong.' };
            }
        }
        throw error;
    }
}
