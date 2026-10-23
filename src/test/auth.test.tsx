import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { safeNextPath } from '@/lib/auth/AuthProvider';
import { createFakeBackend, FAKE_PASSWORD } from './fakeServices';
import { renderApp, renderWorkspace } from './renderApp';

describe('route protection', () => {
  it('shows a neutral splash, never private UI, while the session is being checked', () => {
    renderApp('/settings');
    expect(screen.getByRole('status')).toHaveTextContent(/Checking your session/);
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('redirects signed-out visitors from a private URL to sign-in', async () => {
    renderApp('/settings', { signedIn: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.queryByText('Display currency')).not.toBeInTheDocument();
  });

  it('signs in with valid credentials and returns to the requested page', async () => {
    const { user } = renderApp('/settings', { signedIn: false });
    await user.type(await screen.findByLabelText('Email'), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), FAKE_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('explains invalid credentials without signing in', async () => {
    const { user } = renderApp('/', { signedIn: false });
    await user.type(await screen.findByLabelText('Email'), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is incorrect.');
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('reports network failures during sign-in clearly', async () => {
    const backend = createFakeBackend({ signedIn: false });
    backend.failNext('auth.signIn', new AppError('network', 'We couldn’t reach the TradePilot server. Check your internet connection and try again.'));
    const { user } = renderApp('/', { backend });
    await user.type(await screen.findByLabelText('Email'), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), FAKE_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t reach the TradePilot server/);
  });

  it('validates the sign-in form before contacting the server', async () => {
    const { user, backend } = renderApp('/', { signedIn: false });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(backend.calls).not.toContain('auth.signIn');
  });

  it('removes access to private data after signing out', async () => {
    const { user } = await renderWorkspace('/');
    await user.click(screen.getByRole('button', { name: 'Personal workspace menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.queryByText('Account created')).not.toBeInTheDocument();
  });

  it('tells the user when their session expired and asks them to sign in again', async () => {
    const { backend } = await renderWorkspace('/');
    await act(async () => backend.expireSession());
    expect(await screen.findByText('Your session expired. Please sign in again.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('keeps a registered non-owner out of the workspace', async () => {
    renderApp('/', { isOwner: false, ownerConfigured: true });
    expect(await screen.findByRole('heading', { name: 'This is a private workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('explains the trusted owner bootstrap when no owner exists, without offering a browser shortcut', async () => {
    renderApp('/', { isOwner: false, ownerConfigured: false, email: 'me@example.test' });
    expect(await screen.findByRole('heading', { name: 'Finish setting up your workspace' })).toBeInTheDocument();
    expect(screen.getByText(/npm run owner:assign -- me@example.test/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /claim|make me owner/i })).not.toBeInTheDocument();
  });

  it('shows a retryable error when access cannot be checked', async () => {
    const backend = createFakeBackend();
    backend.failNext('access', new AppError('unavailable', 'Unable to check your workspace access. The server is temporarily unavailable.'));
    const { user } = renderApp('/', { backend });
    expect(await screen.findByRole('heading', { name: 'We couldn’t check your access' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('navigation', { name: 'Primary' })).not.toHaveLength(0);
  });
});

describe('registration and recovery pages', () => {
  it('says so when registration is closed', async () => {
    renderApp('/sign-up', { signedIn: false, signupEnabled: false });
    expect(await screen.findByText(/New registrations are closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
  });

  it('enforces the password policy before submitting a sign-up', async () => {
    const { user } = renderApp('/sign-up', { signedIn: false });
    await user.type(await screen.findByLabelText('Email'), 'new@example.test');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
  });

  it('confirms a sign-up without revealing whether the email was already registered', async () => {
    const { user } = renderApp('/sign-up', { signedIn: false });
    await user.type(await screen.findByLabelText('Email'), 'new@example.test');
    await user.type(screen.getByLabelText('Password'), 'Much-Better-Pass-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'DIV' && /^If new@example\.test can be registered/.test(el.textContent ?? ''))).toBeInTheDocument();
  });

  it('gives the same answer for any email when a reset is requested', async () => {
    const { user } = renderApp('/forgot-password', { signedIn: false });
    await user.type(await screen.findByLabelText('Email'), 'anyone@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account exists for that email/)).toBeInTheDocument();
  });

  it('rejects a reset page opened without a valid recovery link', async () => {
    renderApp('/reset-password?error=access_denied', { signedIn: false });
    const heading = await screen.findByRole('heading', { name: 'Reset link not valid' });
    expect(within(heading.closest('main')!).getByRole('alert')).toHaveTextContent(/expired or has already been used/);
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/settings', '/settings'],
    ['/account?tab=1#x', '/account?tab=1#x'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/sign-in', '/'],
    [null, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
