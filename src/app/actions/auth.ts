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
    // Legacy function - kept for backwards compatibility
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;

    return signupWithRole({
        email,
        password,
        firstName,
        lastName,
        role: 'worker' // Default role
    });
}

interface SignupWithRoleData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: 'admin' | 'worker';
}

export async function signupWithRole(data: SignupWithRoleData): Promise<SignupResult> {
    const { email, password, firstName, lastName, role } = data;

    // Basic validation
    if (!email || !password || !firstName || !lastName || !role) {
        return { success: false, error: 'All fields are required' };
    }

    try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return { success: false, error: 'Account with this email already exists.' };
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Clean up any existing verification tokens for this email
        await prisma.verificationToken.deleteMany({
            where: { identifier: email, type: 'email_verification' }
        });

        // Create verification token with pending user data including role (5 minute expiry)
        const token = crypto.randomUUID();
        const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        await prisma.verificationToken.create({
            data: {
                identifier: email,
                token,
                type: 'email_verification',
                expires,
                password: hashedPassword,
                firstName,
                lastName,
                role
            }
        });

        // Send verification email
        const { sendEmailVerification } = await import('@/lib/email');
        await sendEmailVerification(email, token);

        return { success: true };

    } catch (error: any) {
        console.error("Signup error:", error);
        return { success: false, error: 'Failed to create account.' };
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


