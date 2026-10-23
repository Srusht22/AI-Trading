import { beforeAll, describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { adminClient, browserClient, signedInUser } from './helpers';

type User = Awaited<ReturnType<typeof signedInUser>>;
let a: User;
let b: User;

beforeAll(async () => {
  [a, b] = await Promise.all([signedInUser('data-a'), signedInUser('data-b')]);
});

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to fail');
}

describe('profiles and settings persistence', () => {
  it('creates a profile and default settings at sign-up', async () => {
    const profile = await a.services.profiles.get(a.id);
    const settings = await a.services.settings.get(a.id);
    expect(profile?.id).toBe(a.id);
    expect(settings).toMatchObject({ user_id: a.id, theme: 'dark', timezone: 'UTC', revision: 1 });
  });

  it('persists a settings update and increments the revision', async () => {
    const current = (await a.services.settings.get(a.id))!;
    const saved = await a.services.settings.update(a.id, { theme: 'light', timezone: 'Europe/London' }, current.revision);
    expect(saved).toMatchObject({ theme: 'light', timezone: 'Europe/London', revision: current.revision + 1 });
    // Read back through a brand-new client: it really is stored.
    expect(await a.services.settings.get(a.id)).toMatchObject({ theme: 'light', timezone: 'Europe/London' });
  });

  it('detects a stale revision instead of overwriting newer data', async () => {
    const current = (await a.services.settings.get(a.id))!;
    await a.services.settings.update(a.id, { date_format: 'iso' }, current.revision);
    const e = await rejection(a.services.settings.update(a.id, { date_format: 'dmy' }, current.revision));
    expect(isAppError(e) && e.kind).toBe('conflict');
    expect((await a.services.settings.get(a.id))?.date_format).toBe('iso');
  });

  it('rejects invalid values in the client before any request', async () => {
    const current = (await a.services.settings.get(a.id))!;
    const e = await rejection(a.services.settings.update(a.id, { timezone: 'Mars/Olympus' }, current.revision));
    expect(isAppError(e) && e.kind).toBe('validation');
  });

  it('rejects invalid values in the database even if the client check is bypassed', async () => {
    const { error } = await a.client.from('user_settings').update({ display_currency: 'BTC' }).eq('user_id', a.id);
    expect(error?.code).toBe('23514');
    const { error: tzError } = await a.client.from('user_settings').update({ timezone: 'Not/AZone' }).eq('user_id', a.id);
    expect(tzError?.code).toBe('22023');
  });

  it('recreates a missing profile explicitly instead of failing silently', async () => {
    const c = await signedInUser('data-missing');
    await adminClient().from('profiles').delete().eq('id', c.id);
    expect(await c.services.profiles.get(c.id)).toBeNull();
    const ensured = await c.services.profiles.ensure(c.id);
    expect(ensured.id).toBe(c.id);
  });

  it('saves and clears a display name', async () => {
    expect((await a.services.profiles.updateDisplayName(a.id, 'Integration A')).display_name).toBe('Integration A');
    expect((await a.services.profiles.updateDisplayName(a.id, null)).display_name).toBeNull();
  });

  it('handles a duplicate settings insert as a conflict', async () => {
    const { error } = await a.client.from('user_settings').insert({ user_id: a.id });
    expect(error?.code).toBe('23505');
  });
});

describe('authorization (RLS via the REST API)', () => {
  it('a user cannot read another user’s settings or profile', async () => {
    expect(await a.services.settings.get(b.id)).toBeNull();
    expect(await a.services.profiles.get(b.id)).toBeNull();
    const { data } = await a.client.from('user_settings').select('user_id');
    expect(data?.map((r) => r.user_id)).toEqual([a.id]);
  });

  it('a user cannot modify another user’s records', async () => {
    const before = (await b.services.settings.get(b.id))!;
    const { data } = await a.client.from('user_settings').update({ theme: 'light' }).eq('user_id', b.id).select();
    expect(data).toEqual([]);
    const e = await rejection(a.services.settings.update(b.id, { theme: 'light' }, before.revision));
    expect(isAppError(e) && e.kind).toBe('not_found');
    expect(await b.services.settings.get(b.id)).toMatchObject({ theme: before.theme, revision: before.revision });
  });

  it('a user cannot take over ownership fields', async () => {
    const { error } = await a.client.from('profiles').update({ id: b.id } as never).eq('id', a.id);
    expect(error?.code).toBe('42501');
  });

  it('unauthenticated clients cannot read private tables', async () => {
    const anon = browserClient();
    for (const table of ['profiles', 'user_settings', 'audit_events'] as const) {
      const { data, error } = await anon.from(table).select('*');
      expect(data).toBeNull();
      expect(error?.code).toBe('42501');
    }
    const { error } = await anon.rpc('get_my_access');
    expect(error).not.toBeNull();
  });

  it('a browser client cannot invoke the owner bootstrap', async () => {
    const { error } = await a.client.rpc('admin_assign_owner', { p_email: a.email });
    expect(error?.code).toBe('42501');
    expect(await a.services.access.getMyAccess()).toMatchObject({ isOwner: false });
  });

  it('the owner table is not reachable through the API at all', async () => {
    const { error } = await a.client.schema('private' as never).from('app_owner' as never).select('*');
    expect(error).not.toBeNull();
  });
});

describe('audit trail', () => {
  it('records settings changes server-side, with field names but no values', async () => {
    const current = (await b.services.settings.get(b.id))!;
    await b.services.settings.update(b.id, { display_currency: 'EUR' }, current.revision);
    const { events } = await b.services.audit.listRecent(b.id, { limit: 10 });
    const change = events.find((e) => e.event_type === 'settings.updated');
    expect(change?.metadata).toEqual({ fields: ['display_currency'] });
    expect(JSON.stringify(events)).not.toContain('EUR');
    expect(events.some((e) => e.event_type === 'auth.session_started')).toBe(true);
  });

  it('browser clients cannot forge, edit or delete audit events', async () => {
    const insert = await b.client.from('audit_events').insert({ event_type: 'fake.event', resource_type: 'x' } as never);
    expect(insert.error?.code).toBe('42501');
    const update = await b.client.from('audit_events').update({ event_type: 'x.y' } as never).eq('actor_user_id', b.id);
    expect(update.error?.code).toBe('42501');
    const del = await b.client.from('audit_events').delete().eq('actor_user_id', b.id);
    expect(del.error?.code).toBe('42501');
  });

  it('paginates the full history one event at a time without skipping or repeating any', async () => {
    const all = await b.services.audit.listRecent(b.id, { limit: 50 });
    const walked: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let i = 0; i < 60; i++) {
      const page = await b.services.audit.listRecent(b.id, { limit: 1, before: cursor });
      if (!page.events.length) break;
      walked.push(page.events[0].id);
      cursor = { createdAt: page.events[0].created_at, id: page.events[0].id };
      if (!page.hasMore) break;
    }
    expect(walked).toEqual(all.events.map((e) => e.id));
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('a user never sees another user’s events (unless owner)', async () => {
    const { data } = await a.client.from('audit_events').select('actor_user_id').eq('actor_user_id', b.id);
    expect(data).toEqual([]);
  });
});
