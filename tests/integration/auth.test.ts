import { describe, expect, it } from 'vitest';
import { createSupabaseServices } from '@/services';
import { isAppError } from '@/lib/errors';
import { adminClient, browserClient, env, mailpitLink, PASSWORD, signedInUser, uniqueEmail } from './helpers';

const newServices = () =>
  createSupabaseServices({ supabaseUrl: env.url, supabasePublishableKey: env.anonKey }, 'http://localhost:5173', browserClient());

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to fail');
}

describe('authentication against the real auth server', () => {
  it('establishes a session for valid credentials', async () => {
    const { services, id } = await signedInUser('auth-ok');
    const session = await services.auth.getSession();
    expect(session?.user.id).toBe(id);
  });

  it('rejects a wrong password with a friendly, non-revealing message', async () => {
    const { email } = await signedInUser('auth-bad');
    const e = await rejection(newServices().auth.signIn(email, 'Wrong-Password-1'));
    expect(isAppError(e) && e.kind).toBe('auth');
    expect(isAppError(e) && e.userMessage).toBe('The email or password is incorrect.');
  });

  it('gives the same message for an unknown account', async () => {
    const e = await rejection(newServices().auth.signIn(uniqueEmail('nobody'), PASSWORD));
    expect(isAppError(e) && e.userMessage).toBe('The email or password is incorrect.');
  });

  it('enforces the password policy on sign-up', async () => {
    const e = await rejection(newServices().auth.signUp(uniqueEmail('weak'), 'short'));
    expect(isAppError(e) && e.kind).toBe('validation');
  });

  it('reports whether registration is open from the auth server settings', async () => {
    const status = await newServices().auth.getRegistrationStatus();
    expect(typeof status.signupEnabled).toBe('boolean');
  });

  it('signing out revokes access to private data', async () => {
    const { services, id } = await signedInUser('auth-out');
    expect(await services.settings.get(id)).not.toBeNull();
    await services.auth.signOut('local');
    expect(await services.auth.getSession()).toBeNull();
    // The client now acts as `anon`; PostgREST answers 401 and returns no rows.
    const e = await rejection(services.settings.get(id));
    expect(isAppError(e) && e.kind).toBe('session_expired');
  });

  it('signing out other devices invalidates their refresh tokens', async () => {
    const a = await signedInUser('auth-others');
    // A second, independent "device" signed in as the same user.
    const deviceB = browserClient();
    const { error: signInError } = await deviceB.auth.signInWithPassword({ email: a.email, password: PASSWORD });
    expect(signInError).toBeNull();

    await a.services.auth.signOut('others');

    const { error: refreshError } = await deviceB.auth.refreshSession();
    expect(refreshError).not.toBeNull();
    // The device that requested it keeps working.
    expect(await a.services.settings.get(a.id)).not.toBeNull();
  });
});

describe('email flows (Mailpit)', () => {
  it.skipIf(!env.mailpit)('requires email confirmation before the first sign-in', async () => {
    const email = uniqueEmail('confirm');
    const services = newServices();
    const result = await services.auth.signUp(email, PASSWORD, 'Confirm Tester');
    expect(result.needsEmailConfirmation).toBe(true);
    const e = await rejection(services.auth.signIn(email, PASSWORD));
    expect(isAppError(e) && e.code).toBe('email_not_confirmed');

    const link = await mailpitLink(email, /https?:\/\/\S+\/verify\?\S+/);
    const res = await fetch(link, { redirect: 'manual' });
    expect(res.status).toBe(303);
    await services.auth.signIn(email, PASSWORD);
    const { id } = (await services.auth.getSession())!.user;
    expect((await services.profiles.get(id))?.display_name).toBe('Confirm Tester');
  });

  it.skipIf(!env.mailpit)('sends a password reset link pointing at the reset page', async () => {
    const { email } = await signedInUser('reset');
    await newServices().auth.requestPasswordReset(email);
    const link = await mailpitLink(email, /https?:\/\/\S+\/verify\?\S+/);
    expect(decodeURIComponent(link)).toContain('redirect_to=http://localhost:5173/reset-password');
  });

  it('does not reveal whether an email is registered when requesting a reset', async () => {
    await expect(newServices().auth.requestPasswordReset(uniqueEmail('ghost'))).resolves.toBeUndefined();
  });
});

describe('admin API stays server-side', () => {
  it('rejects user administration with a publishable key', async () => {
    const { error } = await browserClient().auth.admin.listUsers();
    expect(error).not.toBeNull();
  });

  it('works with the service-role key (trusted tooling only)', async () => {
    const { error } = await adminClient().auth.admin.listUsers({ perPage: 1 });
    expect(error).toBeNull();
  });
});
