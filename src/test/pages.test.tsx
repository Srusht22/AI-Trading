import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWorkspace } from './renderApp';

afterEach(() => vi.restoreAllMocks());

describe('dashboard', () => {
  it('defaults to the real workspace and never invents trading figures', async () => {
    await renderWorkspace('/');
    expect(screen.getByText('This is your real workspace')).toBeInTheDocument();
    expect(screen.queryByText('You are viewing sample data')).not.toBeInTheDocument();
    expect(screen.getByText('No performance data yet')).toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it('labels sample data when the preview is switched on, and can switch back', async () => {
    const { user } = await renderWorkspace('/');
    await user.click(screen.getAllByRole('button', { name: 'Preview with sample data' })[0]);
    expect(screen.getByText('You are viewing sample data')).toBeInTheDocument();
    expect(screen.getAllByText(/sample/i).length).toBeGreaterThan(4);
    await user.click(screen.getByRole('button', { name: 'Hide sample data' }));
    expect(screen.getByText('No performance data yet')).toBeInTheDocument();
    expect(localStorage.getItem('tp-sample-data')).toBe('off');
  });

  it('greets the user by their stored display name and lists real account activity', async () => {
    await renderWorkspace('/', { displayName: 'Ana' });
    expect(await screen.findByRole('heading', { level: 1, name: /, Ana\. Welcome to TradePilot AI/ })).toBeInTheDocument();
    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(screen.getByText('Signed in')).toBeInTheDocument();
  });

  it('shows an explicit error, not empty numbers, when activity fails to load', async () => {
    const { AppError } = await import('@/lib/errors');
    const { createFakeBackend } = await import('./fakeServices');
    const backend = createFakeBackend();
    backend.failNext('audit.listRecent', new AppError('network', 'We couldn’t reach the TradePilot server.'));
    await renderWorkspace('/', { backend });
    expect(await screen.findByText('Activity couldn’t be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('links the primary actions to their pages', async () => {
    await renderWorkspace('/');
    expect(screen.getByRole('link', { name: /Explore Strategy Lab/ })).toHaveAttribute('href', '/strategy-lab');
    expect(screen.getByRole('link', { name: /View Robot Library/ })).toHaveAttribute('href', '/robots');
  });
});

describe('backtesting', () => {
  it('validates the form and explains that no test was run', async () => {
    const { user } = await renderWorkspace('/backtesting', { sample: true });
    const deposit = await screen.findByRole('spinbutton', { name: /Initial virtual deposit/ });
    await user.clear(deposit);
    await user.type(deposit, '5');
    await user.click(screen.getByRole('button', { name: 'Run Backtest' }));
    expect(screen.getByText('Enter a virtual deposit of at least 100.')).toBeInTheDocument();

    await user.clear(deposit);
    await user.type(deposit, '10000');
    await user.click(screen.getByRole('button', { name: 'Run Backtest' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No backtest was started/)).toBeInTheDocument();
  });
});

describe('strategy lab', () => {
  it('requires a meaningful description and never contacts an AI service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { user } = await renderWorkspace('/strategy-lab');
    await user.click(await screen.findByRole('button', { name: 'Create Strategy' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 30 characters/);

    await user.click(screen.getByRole('button', { name: /moving-average crossover strategy for EURUSD/ }));
    await user.click(screen.getByRole('button', { name: 'Create Strategy' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/no AI service was contacted/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('AI analyst', () => {
  it('keeps messages local and states they were not sent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { user } = await renderWorkspace('/ai-analyst');
    const input = await screen.findByRole('textbox', { name: /Ask a question/ });
    await user.type(input, 'Explain profit factor{Enter}');
    expect(await screen.findByText('Not sent — the AI service isn’t configured')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('demo trading', () => {
  it('asks for confirmation before the emergency control and takes no action', async () => {
    const { user } = await renderWorkspace('/demo-trading');
    await user.click(await screen.findByRole('button', { name: 'Emergency disable all' }));
    const confirm = await screen.findByRole('dialog', { name: 'Disable all demo robots?' });
    await user.click(within(confirm).getByRole('button', { name: 'Disable all robots' }));
    expect(await screen.findByText(/No instruction was sent/)).toBeInTheDocument();
  });
});

describe('my robots', () => {
  it('filters the library and shows a clear empty result', async () => {
    const { user } = await renderWorkspace('/robots', { sample: true });
    const search = await screen.findByRole('searchbox', { name: /Search robots/ });
    await user.type(search, 'zzz');
    expect(screen.getByText('No robots match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'View details for Grid Recovery' })).toBeInTheDocument();
  });
});
