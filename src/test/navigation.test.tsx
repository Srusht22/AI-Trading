import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { primaryNav } from '@/config/navigation';
import { renderApp } from './renderApp';

const expectedOrder = [
  'Dashboard',
  'My Robots',
  'Strategy Lab',
  'Backtesting',
  'Demo Trading',
  'Analytics & Risk',
  'AI Analyst',
  'Connections & VPS',
  'Settings',
];

describe('primary navigation', () => {
  it('lists the nine sections in the specified order', () => {
    renderApp();
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    const labels = within(nav).getAllByRole('link').map((l) => l.textContent?.trim());
    expect(labels).toEqual(expectedOrder);
  });

  it.each(primaryNav.map((n) => [n.label, n.path] as const))('“%s” leads to its page (%s)', async (label, path) => {
    const { user } = renderApp(path === '/' ? '/settings' : '/');
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    await user.click(within(nav).getByRole('link', { name: label }));
    const name = path === '/' ? /Welcome to TradePilot AI/ : label;
    expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });

  it('shows a helpful page for unknown addresses', async () => {
    renderApp('/does-not-exist');
    expect(await screen.findByText('We couldn’t find that page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/');
  });
});
