import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWorkspace } from './renderApp';

describe('application shell', () => {
  it('collapses and expands the sidebar, remembering the choice on this device', async () => {
    const { user } = await renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('tp-sidebar')).toBe('collapsed');
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('tp-sidebar')).toBe('expanded');
  });

  it('switches theme and saves it to the account, not just the device', async () => {
    const { user, backend } = await renderWorkspace();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    await waitFor(() => expect(backend.settings().theme).toBe('light'));
    expect(backend.settings().revision).toBe(2);
  });

  it('reverts the theme and explains when saving it fails', async () => {
    const { AppError } = await import('@/lib/errors');
    const { user, backend } = await renderWorkspace();
    backend.failNext('settings.update', new AppError('network', 'We couldn’t reach the TradePilot server.'));
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(await screen.findByText('Theme not saved')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(backend.settings().theme).toBe('dark');
  });

  it('never reports an integration that does not exist as connected', async () => {
    await renderWorkspace();
    const status = screen.getAllByRole('group', { name: 'System status' })[0];
    expect(within(status).getAllByText('Later phase').length).toBe(1); // the AI service
    expect(await within(status).findByText('Not paired')).toBeInTheDocument(); // MT5: real status, nothing paired
    expect(within(status).queryByText(/^Connected$/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Demo environment/i).length).toBeGreaterThan(0);
  });

  it('shows the signed-in identity in the workspace menu', async () => {
    const { user } = await renderWorkspace('/', { displayName: 'Ana', email: 'owner@example.test' });
    await user.click(screen.getByRole('button', { name: 'Personal workspace menu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Ana')).toBeInTheDocument();
    expect(within(menu).getByText('owner@example.test')).toBeInTheDocument();
  });

  it('opens the mobile navigation drawer', async () => {
    const { user } = await renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Backtesting' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close navigation menu' }));
  });

  it('shows only local notices and lets them be marked as read', async () => {
    const { user } = await renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    expect(await screen.findByText('Local notices from this website only')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('searches pages and help topics from the keyboard', async () => {
    const { user } = await renderWorkspace('/robots');
    await screen.findByRole('heading', { level: 1, name: 'My Robots' });
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: /Search pages/ });
    await user.type(input, 'vps');
    expect(screen.getByRole('option', { name: /Connections & VPS/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Connections & VPS' })).toBeInTheDocument();
  });
});
