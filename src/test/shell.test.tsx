import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './renderApp';

describe('application shell', () => {
  it('collapses and expands the sidebar, remembering the choice', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('tp-sidebar')).toBe('collapsed');
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('tp-sidebar')).toBe('expanded');
  });

  it('switches theme and persists it locally', async () => {
    const { user } = renderApp();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('tp-theme')).toBe('light');
  });

  it('never reports a connection that does not exist', () => {
    renderApp();
    const status = screen.getAllByRole('group', { name: 'System status' })[0];
    expect(within(status).getByText('Not connected')).toBeInTheDocument();
    expect(within(status).getByText('Not configured')).toBeInTheDocument();
    expect(within(status).queryByText(/^Connected$/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Demo environment/i).length).toBeGreaterThan(0);
  });

  it('opens the mobile navigation drawer', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Backtesting' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close navigation menu' }));
  });

  it('shows only local notices and lets them be marked as read', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    expect(await screen.findByText('Local notices from this website only')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('searches pages and help topics from the keyboard', async () => {
    const { user } = renderApp('/robots');
    await screen.findByRole('heading', { level: 1, name: 'My Robots' });
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: /Search pages/ });
    await user.type(input, 'vps');
    expect(screen.getByRole('option', { name: /Connections & VPS/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Connections & VPS' })).toBeInTheDocument();
  });
});
