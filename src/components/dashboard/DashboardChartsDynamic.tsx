'use client';

import dynamic from 'next/dynamic';

// recharts is a large client-only dependency used solely for these dashboard
// visualisations, so defer it to a lazily-loaded, browser-only chunk instead of
// shipping it in the initial dashboard bundle.
const DashboardCharts = dynamic(() => import('./DashboardCharts'), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="min-h-[440px] animate-pulse rounded-2xl border border-[#e2e8f0] bg-white shadow-sm" />
      <div className="min-h-[400px] animate-pulse rounded-2xl border border-[#e2e8f0] bg-white shadow-sm" />
    </div>
  ),
});

export default DashboardCharts;
