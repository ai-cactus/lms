import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function POST(req: Request) {
    try {
        const { token, firstName, lastName, password } = await req.json();

        // 1. Validate input
        if (!token || !firstName || !lastName || !password) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 2. Find pending invite
        const invite = await prisma.invite.findUnique({
            where: { token, status: 'pending' },
        });

        if (!invite || new Date() > invite.expiresAt) {
            return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 });
        }

        // 3. Check if user already exists (just in case they signed up manually in the meantime)
        const existingUser = await prisma.user.findUnique({
            where: { email: invite.email }
        });

        if (existingUser) {
            return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
        }

        // 4. Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 5. Create User and Profile within a transaction
        // Using transaction ensures atomicity
        const newUser = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email: invite.email,
                    password: hashedPassword,
                    organizationId: invite.organizationId,
                    role: invite.role,
                    profile: {
                        create: {
                            firstName,
                            lastName,
                            fullName: `${firstName} ${lastName}`,
                            email: invite.email
                        }
                    }
                }
            });

            // 6. Mark invite as accepted
            await tx.invite.update({
                where: { id: invite.id },
                data: { status: 'accepted' }
            });

            return user;
        });

        return NextResponse.json({ success: true, userId: newUser.id });

    } catch (error: any) {
        console.error('Error accepting invite:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
