import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { JobStatus } from '@/types/job';

import { JobStatusBadge } from './JobStatusBadge';

describe('JobStatusBadge', () => {
  const cases: [JobStatus, string, string][] = [
    ['queued', 'Queued', 'text-text-secondary'],
    ['processing', 'Processing', 'text-primary'],
    ['completed', 'Completed', 'text-success'],
    ['failed', 'Failed', 'text-error'],
  ];

  test.each(cases)(
    'renders %s with its label and theme-token class',
    (status, label, tokenClass) => {
      const { container } = render(<JobStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(container.firstChild).toHaveClass(tokenClass);
    },
  );

  test('uses no raw hex colour classes', () => {
    const { container } = render(<JobStatusBadge status="completed" />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  test('merges a caller-provided className', () => {
    const { container } = render(<JobStatusBadge status="queued" className="ml-2" />);
    expect(container.firstChild).toHaveClass('ml-2');
  });
});
