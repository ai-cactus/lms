'use server';

import { signIn } from '@/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { AuthError } from 'next-auth';
import { sendPasswordResetEmail } from '@/lib/email';
import crypto from 'crypto';

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

export async function sendPasswordResetLink(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        return { success: true }; // Security: Don't reveal user existence
    }

    // Generate secure UUID token
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Clean up old tokens for this user first
    await prisma.verificationToken.deleteMany({
        where: { identifier: email }
    });

    await prisma.verificationToken.create({
        data: {
            identifier: email,
            token,
            expires
        }
    });

    const emailResult = await sendPasswordResetEmail(email, token);
    if (!emailResult.success) {
        return { success: false, error: "Failed to send email." };
    }

    return { success: true };
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<AuthState> {
    const verificationToken = await prisma.verificationToken.findFirst({
        where: {
            token, // Token is unique enough, but we should verify against user email if we had it in context, 
            // but here the token proves possession of the link.
            expires: { gt: new Date() }
        }
    });

    if (!verificationToken) {
        return { error: 'Invalid or expired reset link.' };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
        where: { email: verificationToken.identifier },
        data: { password: hashedPassword }
    });

    // delete used token
    await prisma.verificationToken.delete({
        where: {
            identifier_token: {
                identifier: verificationToken.identifier,
                token: verificationToken.token
            }
        }
    });

    return { success: true };
}


