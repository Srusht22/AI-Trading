import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from './renderApp';

afterEach(() => vi.restoreAllMocks());

describe('dashboard', () => {
  it('labels sample data and can switch to the honest empty workspace', async () => {
    const { user } = renderApp('/');
    expect(screen.getByText('You are viewing sample data')).toBeInTheDocument();
    expect(screen.getAllByText(/sample/i).length).toBeGreaterThan(4);
    await user.click(screen.getByRole('button', { name: 'Show empty workspace' }));
    expect(screen.getByText('No performance data yet')).toBeInTheDocument();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(localStorage.getItem('tp-sample-data')).toBe('off');
  });

  it('links the primary actions to their pages', () => {
    renderApp('/');
    expect(screen.getByRole('link', { name: /Explore Strategy Lab/ })).toHaveAttribute('href', '/strategy-lab');
    expect(screen.getByRole('link', { name: /View Robot Library/ })).toHaveAttribute('href', '/robots');
  });
});

describe('backtesting', () => {
  it('validates the form and explains that no test was run', async () => {
    const { user } = renderApp('/backtesting');
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
    const { user } = renderApp('/strategy-lab');
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
    const { user } = renderApp('/ai-analyst');
    const input = await screen.findByRole('textbox', { name: /Ask a question/ });
    await user.type(input, 'Explain profit factor{Enter}');
    expect(await screen.findByText('Not sent — the AI service isn’t configured')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('demo trading', () => {
  it('asks for confirmation before the emergency control and takes no action', async () => {
    const { user } = renderApp('/demo-trading');
    await user.click(await screen.findByRole('button', { name: 'Emergency disable all' }));
    const confirm = await screen.findByRole('dialog', { name: 'Disable all demo robots?' });
    await user.click(within(confirm).getByRole('button', { name: 'Disable all robots' }));
    expect(await screen.findByText(/No instruction was sent/)).toBeInTheDocument();
  });
});

describe('my robots', () => {
  it('filters the library and shows a clear empty result', async () => {
    const { user } = renderApp('/robots');
    const search = await screen.findByRole('searchbox', { name: /Search robots/ });
    await user.type(search, 'zzz');
    expect(screen.getByText('No robots match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'View details for Grid Recovery' })).toBeInTheDocument();
  });
});
