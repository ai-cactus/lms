'use client';

import React, { useState, useEffect } from 'react';
import { Button, Input, Select, Modal } from '@/components/ui';
import { updateStaffDetails } from '@/app/actions/staff';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@prisma/client';

interface EditStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    jobTitle: string;
  };
}

export default function EditStaffModal({ isOpen, onClose, staff }: EditStaffModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<UserRole>('worker');
  const [jobTitle, setJobTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (isOpen && staff) {
      // Split name into first/last roughly
      const nameParts = staff.name.split(' ');
      setFirstName(nameParts[0] || '');
      setLastName(nameParts.slice(1).join(' ') || '');
      setRole(staff.role || 'worker');
      setJobTitle(staff.jobTitle || '');
      setMessage(null);
    }
  }, [isOpen, staff]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await updateStaffDetails(staff.id, {
        firstName,
        lastName,
        role,
        jobTitle,
      });

      if (result.success) {
        setMessage({ type: 'success', text: 'Staff details updated successfully' });
        setTimeout(() => {
          router.refresh();
          onClose();
        }, 1000);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Staff Details" size="md">
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#4A5568',
              }}
            >
              First Name
            </label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First Name"
              required
            />
          </div>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#4A5568',
              }}
            >
              Last Name
            </label>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last Name"
              required
            />
          </div>
        </div>

        <div>
          <label
            style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: 500,
              color: '#4A5568',
            }}
          >
            Email (Read Only)
          </label>
          <Input
            value={staff.email}
            disabled
            style={{ backgroundColor: '#F7FAFC', color: '#718096' }}
          />
        </div>

        <div>
          <label
            style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: 500,
              color: '#4A5568',
            }}
          >
            Job Title
          </label>
          <Input
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="e.g. Direct Support Professional"
          />
        </div>

        {message && (
          <div
            style={{
              padding: '10px',
              borderRadius: '6px',
              fontSize: '14px',
              backgroundColor: message.type === 'success' ? '#F0FDF4' : '#FEF2F2',
              color: message.type === 'success' ? '#166534' : '#991B1B',
            }}
          >
            {message.text}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={isLoading}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
