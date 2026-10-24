import { render, screen, within, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityChart } from '@/components/charts/ActivityChart';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { EquityChart } from '@/components/charts/EquityChart';
import { FreshnessBadge } from '@/components/domain/FreshnessBadge';
import { TooltipProvider } from '@/components/ui';
import { bucketByDay } from '@/hooks/useAudit';
import { renderWorkspace } from './renderApp';

// jsdom performs no layout; give elements a size so Recharts actually draws.
const originalRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 300, width: 800, height: 300, toJSON: () => ({}) } as DOMRect;
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
});

const day = (d: string, count: number) => ({ t: Date.parse(`${d}T00:00:00Z`), day: d, count });

describe('chart data binding', () => {
  it('renders one bar per non-empty day from structured data', () => {
    const { container } = render(<ActivityChart data={[day('2026-10-20', 2), day('2026-10-21', 0), day('2026-10-22', 5)]} />);
    expect(container.querySelectorAll('path.recharts-rectangle').length).toBe(2);
  });

  it('updates when its data source changes, without remounting', async () => {
    const { container, rerender } = render(<ActivityChart data={[day('2026-10-20', 1)]} />);
    expect(container.querySelectorAll('path.recharts-rectangle').length).toBe(1);
    const svg = container.querySelector('svg.recharts-surface');
    rerender(<ActivityChart data={[day('2026-10-20', 1), day('2026-10-21', 3), day('2026-10-22', 2)]} />);
    // New bars grow in over the entrance animation.
    await waitFor(() => expect(container.querySelectorAll('path.recharts-rectangle').length).toBe(3));
    expect(container.querySelector('svg.recharts-surface')).toBe(svg);
  });

  it('draws an equity line from points', () => {
    const points = [0, 1, 2].map((i) => ({ t: Date.UTC(2026, 0, i + 1), equity: 10_000 + i * 50, balance: 10_000 + i * 40 }));
    const { container } = render(<EquityChart data={points} />);
    expect(container.querySelector('.recharts-area-curve')?.getAttribute('d')).toBeTruthy();
  });

  it('shows the empty state instead of a chart when there is no data', () => {
    render(
      <ChartContainer title="Equity" empty={<p>No performance data yet</p>}>
        <EquityChart data={[]} />
      </ChartContainer>,
    );
    expect(screen.getByText('No performance data yet')).toBeInTheDocument();
    expect(document.querySelector('.recharts-surface')).toBeNull();
  });

  it('labels sample charts as sample data', () => {
    render(
      <ChartContainer title="Equity" sample>
        <EquityChart data={[{ t: 0, equity: 1, balance: 1 }]} sample />
      </ChartContainer>,
    );
    expect(screen.getByText('Sample data')).toBeInTheDocument();
  });

  it('never represents unavailable MT5 data as live', async () => {
    await renderWorkspace('/');
    const chart = (await screen.findByRole('heading', { name: 'Demo account equity' })).closest('section')!;
    expect(chart).not.toHaveTextContent(/\bLive\b/);
    expect(chart.querySelector('.recharts-area-curve')).toBeNull();
    expect(await within(chart as HTMLElement).findByText('No account connected')).toBeInTheDocument();
  });

  it('draws the sample curve only when sample preview is on, and labels it', async () => {
    await renderWorkspace('/', { sample: true });
    const chart = screen.getByRole('heading', { name: 'Performance overview' }).closest('section')!;
    expect(chart.querySelector('.recharts-area-curve')).not.toBeNull();
    expect(chart).toHaveTextContent('Sample data');
  });

  it('describes freshness states in words', () => {
    render(
      <TooltipProvider>
        <FreshnessBadge freshness={{ state: 'stale', lastUpdateAt: null }} />
        <FreshnessBadge freshness={{ state: 'disconnected', lastUpdateAt: '2026-10-22T10:00:00Z' }} />
      </TooltipProvider>,
    );
    expect(screen.getByText('No recent data')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});

describe('bucketByDay', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('counts events per calendar day and includes empty days', () => {
    const r = bucketByDay(['2026-10-23T01:00:00Z', '2026-10-23T09:00:00Z', '2026-10-21T10:00:00Z'], 3, 'UTC', now);
    expect(r.map((d) => [d.day, d.count])).toEqual([
      ['2026-10-21', 1],
      ['2026-10-22', 0],
      ['2026-10-23', 2],
    ]);
  });

  it('uses the display timezone to decide which day an event belongs to', () => {
    // 23:30 UTC on the 22nd is already the 23rd in Tokyo.
    const r = bucketByDay(['2026-10-22T23:30:00Z'], 2, 'Asia/Tokyo', now);
    expect(r.find((d) => d.day === '2026-10-23')?.count).toBe(1);
  });

  it('produces exactly one bucket per day across a DST change', () => {
    const r = bucketByDay([], 7, 'Europe/London', new Date('2026-10-28T12:00:00Z'));
    expect(r.map((d) => d.day)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
  });
});
