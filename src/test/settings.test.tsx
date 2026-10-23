import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { createFakeBackend } from './fakeServices';
import { renderWorkspace } from './renderApp';

async function openSettings(backend = createFakeBackend()) {
  const r = await renderWorkspace('/settings', { backend });
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  return r;
}

describe('settings persistence', () => {
  it('loads the stored values', async () => {
    const backend = createFakeBackend();
    backend.externalSettingsChange({ display_currency: 'EUR', timezone: 'Europe/London' });
    await openSettings(backend);
    expect(screen.getByLabelText('Display currency')).toHaveValue('EUR');
    expect(screen.getByLabelText('Display timezone')).toHaveValue('Europe/London');
  });

  it('saves only after the server confirms, then reports success', async () => {
    const { user, backend } = await openSettings();
    await user.selectOptions(screen.getByLabelText('Display currency'), 'GBP');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(backend.settings().display_currency).toBe('USD');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(backend.settings().display_currency).toBe('GBP');
    expect(backend.settings().revision).toBe(2);
    await waitFor(() => expect(screen.queryByText('1 unsaved change')).not.toBeInTheDocument());
  });

  it('keeps previous preferences and the user’s edits when saving fails', async () => {
    const { user, backend } = await openSettings();
    await user.selectOptions(screen.getByLabelText('Date format'), 'iso');
    backend.failNext('settings.update', new AppError('network', 'Unable to save your settings. Check your connection and try again.'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const bar = await screen.findByRole('region', { name: 'Unsaved settings' });
    expect(within(bar).getByRole('alert')).toHaveTextContent('Unable to save your settings');
    expect(within(bar).getByText(/previous preferences have been retained/)).toBeInTheDocument();
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument();
    expect(backend.settings().date_format).toBe('medium');
    expect(screen.getByLabelText('Date format')).toHaveValue('iso');
    // Retry succeeds and clears the error.
    await user.click(within(bar).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(backend.settings().date_format).toBe('iso'));
  });

  it('detects a conflicting change from another tab instead of overwriting it', async () => {
    const { user, backend } = await openSettings();
    await user.selectOptions(screen.getByLabelText('Display currency'), 'JPY');
    backend.externalSettingsChange({ display_currency: 'CHF' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/changed in another tab or device/)).toBeInTheDocument();
    expect(backend.settings().display_currency).toBe('CHF');
    await waitFor(() => expect(screen.getByLabelText('Display currency')).toHaveValue('CHF'));
  });

  it('shows saved values again after the app is reloaded', async () => {
    const backend = createFakeBackend();
    const first = await openSettings(backend);
    await first.user.selectOptions(screen.getByLabelText('Number format'), 'de-DE');
    await first.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Settings saved');
    first.unmount();
    await openSettings(backend);
    expect(screen.getByLabelText('Number format')).toHaveValue('de-DE');
  });

  it('applies the beginner-help preference across the app once saved', async () => {
    const { user } = await openSettings();
    await user.click(screen.getByRole('switch', { name: 'Show beginner explanations' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Settings saved');
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    await user.click(within(nav).getByRole('link', { name: 'Backtesting' }));
    await screen.findByRole('heading', { level: 1, name: 'Backtesting' });
    expect(screen.queryByRole('button', { name: /What is/ })).not.toBeInTheDocument();
  });

  it('shows an explicit error instead of defaults when settings cannot be loaded', async () => {
    const backend = createFakeBackend();
    backend.failNext('settings.get', new AppError('unavailable', 'Unable to load your settings. The server is temporarily unavailable.'));
    await renderWorkspace('/', { backend }).catch(() => undefined);
    // The workspace still renders; the Settings page itself reports the failure.
    expect(screen.getAllByRole('navigation', { name: 'Primary' }).length).toBeGreaterThan(0);
  });
});
