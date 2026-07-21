'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';
import { cn } from '@/lib/utils';
import type { Role } from '@/types/next-auth';
import type { SettingsTeamMember } from './SettingsClient';

interface UsersPermissionsTabProps {
  members: SettingsTeamMember[];
  onInvite: () => void;
}

// Owner reads as the primary tint; finance/HR get their own semantic tints; every
// other role falls back to a neutral chip.
const ROLE_CHIP_CLASS: Partial<Record<Role, string>> = {
  owner: 'bg-primary/10 text-primary',
  finance: 'bg-success/10 text-success',
  hr: 'bg-warning/10 text-warning',
};
const DEFAULT_CHIP_CLASS = 'bg-background-secondary text-text-secondary';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relativeLastActive(iso: string | null): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'Just now';
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
}

export default function UsersPermissionsTab({ members, onInvite }: UsersPermissionsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => {
      const roleLabel = getRoleDisplayName(member.role).toLowerCase();
      return (
        member.name.toLowerCase().includes(query) ||
        member.email.toLowerCase().includes(query) ||
        roleLabel.includes(query)
      );
    });
  }, [members, searchQuery]);

  return (
    <div className="flex flex-col">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Team members</h2>
          <p className="text-sm text-text-secondary">
            Invite people and set their access by assigning a role. Permissions follow the role.
          </p>
        </div>
        <Button type="button" onClick={onInvite}>
          Invite user
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-background p-4 sm:p-6">
        <div className="mb-6 w-full">
          <Input
            className="h-11"
            placeholder="Search users by name, email, or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            startIcon={<Search aria-hidden="true" />}
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead>Name</TableHead>
              <TableHead>System role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMembers.length > 0 ? (
              filteredMembers.map((member) => (
                <TableRow key={member.id} className="hover:bg-transparent">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {initials(member.name)}
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold text-foreground">
                          {member.name}
                        </span>
                        <span className="truncate text-xs text-text-secondary">{member.email}</span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        ROLE_CHIP_CLASS[member.role] ?? DEFAULT_CHIP_CLASS,
                      )}
                    >
                      {getRoleDisplayName(member.role)}
                    </span>
                  </TableCell>

                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          member.isPending ? 'bg-warning' : 'bg-success',
                        )}
                        aria-hidden="true"
                      />
                      <span className={member.isPending ? 'text-warning' : 'text-success'}>
                        {member.isPending ? 'Pending' : 'Active'}
                      </span>
                    </span>
                  </TableCell>

                  <TableCell className="text-text-secondary whitespace-nowrap">
                    {member.isPending ? '—' : relativeLastActive(member.lastLoginAt)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="p-[60px] text-center text-text-secondary">
                  No team members match your search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
