'use client';

import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
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
  owner: 'bg-[#f4f3ff] text-primary',
  finance: 'bg-[#f3fff8] text-[#0ec858]',
  hr: 'bg-warning/10 text-warning',
};
const DEFAULT_CHIP_CLASS = 'bg-[#f9fafb] text-[#667085]';
const CHIP_CLASS = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold';

const HEAD_CELL_CLASS =
  'h-auto bg-[#f9fafb] px-6 py-3.5 text-sm leading-6 font-medium text-[#667085]';
const BODY_CELL_CLASS = 'px-6 py-3.5 align-middle text-sm font-normal';

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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-[#101928]">Team members</h2>
          <p className="text-sm text-[#667085]">
            Invite people and set their access by assigning a role. Permissions follow the role.
          </p>
        </div>
        <Button type="button" onClick={onInvite} className="gap-2 font-semibold">
          <Plus aria-hidden="true" />
          Invite user
        </Button>
      </div>

      <div className="rounded-2xl border border-[#eceef2] bg-background">
        <div className="flex justify-end p-4">
          <div className="w-full max-w-[440px]">
            <Input
              className="h-11 rounded-xl border-[#e4e7ec] text-sm placeholder:text-[#98a2b3]"
              placeholder="Search users by name, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              startIcon={<Search aria-hidden="true" />}
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-none hover:bg-transparent">
              <TableHead className={cn(HEAD_CELL_CLASS, 'md:w-[360px]')}>Name</TableHead>
              <TableHead className={cn(HEAD_CELL_CLASS, 'hidden sm:table-cell md:w-[180px]')}>
                System role
              </TableHead>
              <TableHead className={cn(HEAD_CELL_CLASS, 'md:w-[160px]')}>Status</TableHead>
              <TableHead className={cn(HEAD_CELL_CLASS, 'hidden md:table-cell md:w-[150px]')}>
                Last active
              </TableHead>
              {/* Trailing gutter — keeps the four content columns on the design's
                  fixed widths instead of stretching to fill the card. */}
              <TableHead className={cn(HEAD_CELL_CLASS, 'hidden md:table-cell')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMembers.length > 0 ? (
              filteredMembers.map((member) => (
                <TableRow key={member.id} className="border-none hover:bg-transparent">
                  <TableCell className={BODY_CELL_CLASS}>
                    <div className="flex items-start gap-3 sm:items-center">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fce7f3] text-[13px] font-semibold text-[#be185d]">
                        {initials(member.name)}
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-semibold text-[#101928]">
                          {member.name}
                        </span>
                        <span className="truncate text-[13px] text-[#667085]">{member.email}</span>
                        <span
                          className={cn(
                            CHIP_CLASS,
                            'mt-1 self-start sm:hidden',
                            ROLE_CHIP_CLASS[member.role] ?? DEFAULT_CHIP_CLASS,
                          )}
                        >
                          {getRoleDisplayName(member.role)}
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className={cn(BODY_CELL_CLASS, 'hidden sm:table-cell')}>
                    <span
                      className={cn(CHIP_CLASS, ROLE_CHIP_CLASS[member.role] ?? DEFAULT_CHIP_CLASS)}
                    >
                      {getRoleDisplayName(member.role)}
                    </span>
                  </TableCell>

                  <TableCell className={BODY_CELL_CLASS}>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          member.isPending ? 'bg-warning' : 'bg-[#12b76a]',
                        )}
                        aria-hidden="true"
                      />
                      <span className={member.isPending ? 'text-warning' : 'text-[#027a48]'}>
                        {member.isPending ? 'Pending' : 'Active'}
                      </span>
                    </span>
                  </TableCell>

                  <TableCell
                    className={cn(
                      BODY_CELL_CLASS,
                      'hidden whitespace-nowrap text-[#667085] md:table-cell',
                    )}
                  >
                    {member.isPending ? '—' : relativeLastActive(member.lastLoginAt)}
                  </TableCell>

                  <TableCell className={cn(BODY_CELL_CLASS, 'hidden md:table-cell')} />
                </TableRow>
              ))
            ) : (
              <TableRow className="border-none hover:bg-transparent">
                <TableCell colSpan={5} className="p-[60px] text-center text-sm text-[#667085]">
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
