'use server';

import { signIn } from '@/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { AuthError } from 'next-auth';

// Define return type
export type AuthState = {
    error?: string;
    success?: boolean;
};

export async function authenticate(prevState: AuthState | undefined, formData: FormData): Promise<AuthState> {
    try {
        await signIn('credentials', {
            ...Object.fromEntries(formData),
            redirect: false, // Prevent server-side redirect to stop reload
        });
        return { success: true };
    } catch (error) {
        if (error instanceof AuthError) {
            switch (error.type) {
                case 'CredentialsSignin':
                    return { error: 'Invalid credentials.' };
                default:
                    return { error: 'Something went wrong.' };
            }
        }
        throw error;
    }
}

export type SignupResult = { success: true } | { success: false; error: string };

export async function signup(prevState: SignupResult | undefined, formData: FormData): Promise<SignupResult> {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;

    // Basic validation
    if (!email || !password) {
        return { success: false, error: 'Missing fields' };
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                }
            });

            await tx.profile.create({
                data: {
                    id: user.id,
                    email: user.email,
                    firstName,
                    lastName,
                    fullName: `${firstName} ${lastName}`,
                    role: 'worker', // Default role
                }
            })
        })

    } catch (error: any) {
        console.error("Signup error:", error);
        if (error.code === 'P2002') {
            return { success: false, error: 'Account with this email already exists.' };
        }
        return { success: false, error: 'Failed to create account.' };
    }

    // Attempt Login after signup
    try {
        await signIn('credentials', {
            email,
            password,
            redirect: false  // Don't redirect from server, let client handle it
        });
        return { success: true };
    } catch (error) {
        if (error instanceof AuthError) {
            switch (error.type) {
                case 'CredentialsSignin':
                    return { success: false, error: 'Signup successful but auto-login failed.' };
                default:
                    return { success: false, error: 'Something went wrong.' };
            }
        }
        // For other errors (like NEXT_REDIRECT), still return success since user was created
        return { success: true };
    }
}


