'use client';

import React, { useState } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { createInvites } from '@/app/actions/invite';
import { useRouter } from 'next/navigation';

interface InviteStaffModalProps {
    isOpen: boolean;
    onClose: () => void;
    organizationId: string; // We might need to pass this or fetch it
}

export default function InviteStaffModal({ isOpen, onClose, organizationId }: InviteStaffModalProps) {
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('worker');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const router = useRouter();

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setMessage(null);

        try {
            // We reuse the existing createInvites action
            // It expects an array of emails
            const result = await createInvites([email], role, organizationId);

            if (result.success) {
                setMessage({ type: 'success', text: `Invitation sent to ${email}` });
                setEmail(''); // Clear input
                setTimeout(() => {
                    onClose();
                    router.refresh(); // Refresh data
                }, 1500);
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to send invite' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'An unexpected error occurred' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50
        }}>
            <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                width: '100%',
                maxWidth: '400px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
            }}>
                <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '16px', color: '#1A202C' }}>
                    Invite New Staff
                </h2>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500, color: '#4A5568' }}>
                            Email Address
                        </label>
                        <Input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="colleague@example.com"
                            required
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500, color: '#4A5568' }}>
                            Role
                        </label>
                        <Select
                            value={role}
                            onChange={(val) => setRole(val)}
                            options={[
                                { label: 'Worker', value: 'worker' },
                                { label: 'Supervisor', value: 'supervisor' },
                                { label: 'Manager', value: 'manager' },
                                { label: 'Admin', value: 'admin' }
                            ]}
                        />
                    </div>

                    {message && (
                        <div style={{
                            padding: '10px',
                            borderRadius: '6px',
                            fontSize: '14px',
                            backgroundColor: message.type === 'success' ? '#F0FDF4' : '#FEF2F2',
                            color: message.type === 'success' ? '#166534' : '#991B1B'
                        }}>
                            {message.text}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                        <Button variant="outline" type="button" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button variant="primary" type="submit" loading={isLoading} disabled={!email}>
                            Send Invite
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
