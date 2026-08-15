/**
 * Tests for the Global View's comparison mode: which facilities the two tables
 * show, the "Comparing N of M" / "Showing N of N selected" copy, the KPIs that
 * are re-aggregated over the selection, and what the scope control is handed.
 * The unfiltered view is asserted alongside as the baseline.
 */
import type { JSX } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GlobalDashboardData } from '@/app/actions/dashboard-facility';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockScopeSwitcher = vi.fn<(props: unknown) => JSX.Element>(() => (
  <div data-testid="facility-switcher" />
));
vi.mock('@/components/dashboard/FacilityScopeSwitcher', () => ({
  default: (props: unknown) => mockScopeSwitcher(props),
}));

import GlobalDashboardView from './GlobalDashboardView';

const DATA: GlobalDashboardData = {
  facilities: [
    { id: 'fac-a', name: 'Alpha Site', type: 'clinic', city: 'Austin' },
    { id: 'fac-b', name: 'Beta Site', type: 'clinic', city: 'Dallas' },
    { id: 'fac-c', name: 'Gamma Site', type: 'clinic', city: 'Houston' },
  ],
  enterpriseFootprint: {
    totalFacilities: { value: 3, trendPercent: null },
    totalStaff: { value: 60, trendPercent: null },
  },
  trainingVelocity: {
    activeLearners: { value: 30, trendPercent: null },
    ongoingCourses: { value: 12, trendPercent: null },
    firstTimePassRate: { value: 88, trendPercent: null },
  },
  riskCompliance: {
    overdueTrainings: { value: 9, trendPercent: null },
    dormantStaff: { value: 4, trendPercent: null },
    expiringCredentials: { value: 7, trendPercent: null },
  },
  priorityRisks: ['fac-a', 'fac-b', 'fac-c'].map((facilityId, index) => ({
    facilityId,
    name: `${['Alpha', 'Beta', 'Gamma'][index]} Site`,
    type: 'clinic',
    activeLearners: (index + 1) * 5,
    approachingDeadlines: index,
    overdueTrainings: index + 1,
    riskLevel: 'low' as const,
  })),
  facilitiesOverview: ['fac-a', 'fac-b', 'fac-c'].map((facilityId, index) => ({
    facilityId,
    name: `${['Alpha', 'Beta', 'Gamma'][index]} Site`,
    type: 'clinic',
    staffCount: (index + 1) * 10,
    activeTrainings: 4,
    completionPercent: 90 - index,
    auditReadinessPercent: 95,
    auditReadiness: 'audit_ready' as const,
    riskLevel: 'low' as const,
  })),
};

function section(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const element = heading.closest('section');
  if (!element) throw new Error(`No section for "${title}"`);
  return element;
}

const FOOTPRINT = 'Enterprise Footprint';
const VELOCITY = 'Training Velocity';
const RISK = 'Risk, Compliance & Deadlines (Urgent Attention Needed)';

/** A metric card's value, scoped to its group — several labels also head table columns. */
function metricValue(groupTitle: string, label: string): string | null {
  const card = within(section(groupTitle)).getByText(label);
  return card.nextElementSibling?.textContent ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GlobalDashboardView — unfiltered', () => {
  it('shows every facility and the organisation KPIs', () => {
    render(<GlobalDashboardView data={DATA} userName="Jane" />);

    const overview = section('Facilities Overview');
    expect(
      within(overview).getByText('Performance overview across all facilities'),
    ).toBeInTheDocument();
    expect(within(overview).getByText('Showing 1 to 3 of 3 facilities')).toBeInTheDocument();
    expect(within(overview).getByText('Beta Site')).toBeInTheDocument();
    expect(metricValue(FOOTPRINT, 'Total Staff Count')).toBe('60');
  });

  it('drills into a facility from the row itself, with no separate "View dashboard" link', async () => {
    const user = userEvent.setup();
    render(<GlobalDashboardView data={DATA} userName="Jane" />);

    expect(screen.queryByRole('link', { name: /view dashboard/i })).not.toBeInTheDocument();

    const overview = section('Facilities Overview');
    await user.click(within(overview).getByRole('row', { name: 'View dashboard for Beta Site' }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard?facility=fac-b');
  });

  it('reports an empty scope to the switcher', () => {
    render(<GlobalDashboardView data={DATA} userName="Jane" />);

    expect(mockScopeSwitcher).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFacilityIds: [],
        completionPercentByFacilityId: { 'fac-a': 90, 'fac-b': 89, 'fac-c': 88 },
      }),
    );
  });
});

describe('GlobalDashboardView — comparison', () => {
  function renderComparison(ids = ['fac-a', 'fac-c']) {
    render(<GlobalDashboardView data={DATA} userName="Jane" comparedFacilityIds={ids} />);
  }

  it('narrows the Facilities Overview table to the selection', () => {
    renderComparison();

    const overview = section('Facilities Overview');
    expect(within(overview).getByText('Comparing 2 of 3 facilities')).toBeInTheDocument();
    expect(within(overview).getByText('Showing 2 of 2 selected facilities')).toBeInTheDocument();
    expect(within(overview).getByText('Alpha Site')).toBeInTheDocument();
    expect(within(overview).getByText('Gamma Site')).toBeInTheDocument();
    expect(within(overview).queryByText('Beta Site')).not.toBeInTheDocument();
  });

  it('narrows the Priority Risks table to the same selection', () => {
    renderComparison();

    const risks = section('Priority Risks & Deadlines by Facilities');
    expect(within(risks).getByText('Showing 2 of 2 selected facilities')).toBeInTheDocument();
    expect(within(risks).queryByText('Beta Site')).not.toBeInTheDocument();
  });

  it('re-aggregates the per-facility KPIs over the selection', () => {
    renderComparison();

    expect(metricValue(FOOTPRINT, 'Total Number of Facilities')).toBe('2');
    expect(metricValue(FOOTPRINT, 'Total Staff Count')).toBe('40');
    expect(metricValue(VELOCITY, 'Active Learners')).toBe('20');
    expect(metricValue(RISK, 'Overdue Trainings')).toBe('4');
  });

  it('keeps the organisation value for metrics with no per-facility breakdown', () => {
    renderComparison();

    expect(metricValue(VELOCITY, 'Ongoing Courses')).toBe('12');
    expect(metricValue(RISK, 'Dormant Staff')).toBe('4');
  });

  it('reports the compared ids to the switcher', () => {
    renderComparison();

    expect(mockScopeSwitcher).toHaveBeenCalledWith(
      expect.objectContaining({ selectedFacilityIds: ['fac-a', 'fac-c'] }),
    );
  });

  it('ignores ids outside the payload and keeps the full view below two survivors', () => {
    renderComparison(['fac-a', 'other-tenant']);

    const overview = section('Facilities Overview');
    expect(
      within(overview).getByText('Performance overview across all facilities'),
    ).toBeInTheDocument();
    expect(within(overview).getByText('Beta Site')).toBeInTheDocument();
  });
});
