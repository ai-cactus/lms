import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Get base URL for redirects (use APP_URL for Cloudflare Tunnel)
const getBaseUrl = () => {
    return process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://staging-lms.theraptly.com';
};

export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token');
    const baseUrl = getBaseUrl();

    if (!token) {
        return NextResponse.redirect(`${baseUrl}/verify-email?error=missing_token`);
    }

    try {
        // Find the verification token with pending user data
        const verificationToken = await prisma.verificationToken.findFirst({
            where: {
                token,
                type: 'email_verification',
                expires: { gt: new Date() }
            }
        });

        if (!verificationToken) {
            return NextResponse.redirect(`${baseUrl}/verify-email?error=invalid_or_expired`);
        }

        // Check if user already exists (shouldn't happen, but just in case)
        const existingUser = await prisma.user.findUnique({
            where: { email: verificationToken.identifier }
        });

        if (existingUser) {
            // User already exists, just delete token and redirect
            await prisma.verificationToken.delete({
                where: {
                    identifier_token: {
                        identifier: verificationToken.identifier,
                        token: verificationToken.token
                    }
                }
            });
            return NextResponse.redirect(`${baseUrl}/login?verified=true`);
        }

        // Create the user and profile from pending data
        if (!verificationToken.password || !verificationToken.firstName || !verificationToken.lastName) {
            return NextResponse.redirect(`${baseUrl}/verify-email?error=invalid_data`);
        }

        // Default to 'worker' if role not set
        const userRole = verificationToken.role || 'worker';

        await prisma.$transaction(async (tx) => {
            // Create the user with selected role
            const user = await tx.user.create({
                data: {
                    email: verificationToken.identifier,
                    password: verificationToken.password!,
                    emailVerified: true,
                    role: userRole,
                }
            });

            // Create the profile
            await tx.profile.create({
                data: {
                    id: user.id,
                    email: user.email,
                    firstName: verificationToken.firstName!,
                    lastName: verificationToken.lastName!,
                    fullName: `${verificationToken.firstName} ${verificationToken.lastName}`,
                }
            });

            // Delete the verification token
            await tx.verificationToken.delete({
                where: {
                    identifier_token: {
                        identifier: verificationToken.identifier,
                        token: verificationToken.token
                    }
                }
            });
        });

        // Redirect to login with success message
        return NextResponse.redirect(`${baseUrl}/login?verified=true`);

    } catch (error) {
        console.error('Verification error:', error);
        return NextResponse.redirect(`${baseUrl}/verify-email?error=server_error`);
    }
}
