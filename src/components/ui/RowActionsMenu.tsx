'use client';

import * as React from 'react';
import Link from 'next/link';
import { MoreVertical } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  /** Navigate (rendered as a link). Takes precedence over onSelect. */
  href?: string;
  /** Action handler (rendered as a button-style item). */
  onSelect?: () => void;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  /** Render a divider above this item. */
  separatorBefore?: boolean;
}

interface RowActionsMenuProps {
  actions: RowAction[];
  /** Accessible label for the trigger. */
  label?: string;
  align?: 'start' | 'end';
  className?: string;
}

/**
 * Reusable, themed kebab (⋮) menu for table rows. Renders a `MoreVertical`
 * trigger and a styled dropdown of actions (links or handlers, with optional
 * icons, dividers, and a destructive variant). Use inside a `<TableCell>` with
 * `onClick={(e) => e.stopPropagation()}` so it doesn't trigger row navigation.
 */
export function RowActionsMenu({
  actions,
  label = 'Row actions',
  align = 'end',
  className,
}: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-foreground',
            className,
          )}
        >
          <MoreVertical className="size-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} className="min-w-[184px] rounded-xl p-1.5">
        {actions.map((action, i) => {
          const itemClass = 'cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium';
          return (
            <React.Fragment key={`${action.label}-${i}`}>
              {action.separatorBefore && <DropdownMenuSeparator />}
              {action.href ? (
                <DropdownMenuItem
                  asChild
                  variant={action.variant}
                  disabled={action.disabled}
                  className={itemClass}
                >
                  <Link href={action.href}>
                    {action.icon}
                    {action.label}
                  </Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  variant={action.variant}
                  disabled={action.disabled}
                  onSelect={action.onSelect}
                  className={itemClass}
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              )}
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
