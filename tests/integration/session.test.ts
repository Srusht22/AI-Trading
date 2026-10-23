import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { isAppError } from '@/lib/errors';
import { createSupabaseServices } from '@/services';
import { browserClient, env, PASSWORD, signedInUser } from './helpers';

/** A client that presents a fixed access token, as an attacker who copied it would. */
function clientWithToken(accessToken: string) {
  return createClient<Database>(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function accessToken(client: ReturnType<typeof browserClient>) {
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

describe('access is bound to a live session', () => {
  it('a copied access token stops working as soon as the user signs out', async () => {
    const u = await signedInUser('sess-signout');
    const stolen = clientWithToken(await accessToken(u.client));
    expect((await stolen.from('user_settings').select('user_id')).data).toHaveLength(1);

    await u.services.auth.signOut('local');

    // The JWT is still cryptographically valid and unexpired — but its session is gone.
    const after = await stolen.from('user_settings').select('user_id');
    expect(after.data ?? []).toHaveLength(0);
    const audit = await stolen.from('audit_events').select('id');
    expect(audit.data ?? []).toHaveLength(0);
    const write = await stolen.from('profiles').update({ display_name: 'Attacker' }).eq('id', u.id).select();
    expect(write.data ?? []).toHaveLength(0);
  });

  it('“sign out other devices” immediately cuts off their unexpired access tokens', async () => {
    const a = await signedInUser('sess-others');
    const deviceB = browserClient();
    await deviceB.auth.signInWithPassword({ email: a.email, password: PASSWORD });
    const deviceBToken = clientWithToken(await accessToken(deviceB));
    expect((await deviceBToken.from('profiles').select('id')).data).toHaveLength(1);

    await a.services.auth.signOut('others');

    expect((await deviceBToken.from('profiles').select('id')).data ?? []).toHaveLength(0);
    expect(await a.services.profiles.get(a.id)).not.toBeNull(); // the requesting device keeps access
  });

  it('reports a revoked session as expired, not as missing ownership', async () => {
    const u = await signedInUser('sess-access');
    const token = await accessToken(u.client);
    await u.services.auth.signOut('local');
    const services = createSupabaseServices({ supabaseUrl: env.url, supabasePublishableKey: env.anonKey }, 'http://localhost:5173', clientWithToken(token));
    const e = await services.access.getMyAccess().then(
      () => null,
      (err: unknown) => err,
    );
    expect(isAppError(e) && e.kind).toBe('session_expired');
  });

  it('a user cannot make themselves owner via self-editable user metadata', async () => {
    const u = await signedInUser('sess-meta');
    const { error } = await u.client.auth.updateUser({ data: { role: 'owner', is_owner: true, owner: true } });
    expect(error).toBeNull();
    await u.client.auth.refreshSession(); // new token carries the edited user_metadata
    expect(await u.services.access.getMyAccess()).toMatchObject({ isOwner: false });
    const { data: profile } = await u.client.from('profiles').select('*').eq('id', u.id).single();
    expect(Object.keys(profile!)).toEqual(['id', 'display_name', 'created_at', 'updated_at']);
  });
});

const realtimeUp = await fetch(`${env.url}/realtime/v1/api/ping`, { headers: { apikey: env.anonKey } })
  .then((r) => r.status === 200 || r.status === 401)
  .catch(() => false);
if (!realtimeUp) console.warn('[integration] Realtime not reachable — revoked-subscription test is SKIPPED, not passed.');

describe.skipIf(!realtimeUp)('realtime after revocation', () => {
  it('a subscription made with a token whose session was revoked receives nothing', async () => {
    const u = await signedInUser('sess-rt');
    const token = await accessToken(u.client);
    const attacker = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    attacker.realtime.setAuth(token);
    const seen: string[] = [];
    let ready = false;
    const ch = attacker
      .channel(`stolen:${u.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_settings' }, (p) => seen.push((p.new as { theme: string }).theme))
      .on('system', {}, (m: { extension?: string; status?: string }) => {
        if (m.extension === 'postgres_changes' && m.status === 'ok') ready = true;
      })
      .subscribe();
    for (let i = 0; i < 80 && !ready; i++) await new Promise((r) => setTimeout(r, 100));
    expect(ready).toBe(true);

    // Sanity: while the session is live, the stolen token does receive the user's change.
    let s = (await u.services.settings.get(u.id))!;
    await u.services.settings.update(u.id, { theme: 'light' }, s.revision);
    for (let i = 0; i < 80 && !seen.includes('light'); i++) await new Promise((r) => setTimeout(r, 100));
    expect(seen).toContain('light');

    // Revoke every session of this user from a second device, then change data again.
    const device = browserClient();
    await device.auth.signInWithPassword({ email: u.email, password: PASSWORD });
    const deviceServices = createSupabaseServices({ supabaseUrl: env.url, supabasePublishableKey: env.anonKey }, 'http://localhost:5173', device);
    await deviceServices.auth.signOut('others');
    s = (await deviceServices.settings.get(u.id))!;
    await deviceServices.settings.update(u.id, { theme: 'dark' }, s.revision);
    await new Promise((r) => setTimeout(r, 2500));
    expect(seen).not.toContain('dark');
    await attacker.removeChannel(ch);
  });
});
