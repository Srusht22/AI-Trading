import { describe, expect, it } from 'vitest';
import type { LiveStatus } from '@/services/types';
import { env, signedInUser } from './helpers';

/** Is the Realtime service reachable on this stack? */
async function realtimeAvailable() {
  try {
    const res = await fetch(`${env.url}/realtime/v1/api/ping`, { headers: { apikey: env.anonKey } });
    return res.status !== 503 && res.status !== 404;
  } catch {
    return false;
  }
}

const available = await realtimeAvailable();
if (!available) console.warn('[integration] Realtime service not reachable — realtime tests are SKIPPED, not passed.');

const until = async (cond: () => boolean, ms = 8000) => {
  for (let t = 0; t < ms && !cond(); t += 100) await new Promise((r) => setTimeout(r, 100));
};

describe.skipIf(!available)('realtime delivery', () => {
  it('reports live only after the database subscription is confirmed, then delivers own changes', async () => {
    const a = await signedInUser('rt-svc');
    const statuses: LiveStatus[] = [];
    let changes = 0;
    const stop = a.services.realtime.watchRows({
      channel: `test-settings:${a.id}`,
      table: 'user_settings',
      filter: `user_id=eq.${a.id}`,
      onChange: () => changes++,
      onStatus: (s) => statuses.push(s),
    });
    await until(() => statuses.includes('live'));
    expect(statuses[0]).toBe('connecting');
    expect(statuses).toContain('live');

    const before = changes;
    const s = (await a.services.settings.get(a.id))!;
    await a.services.settings.update(a.id, { theme: 'light' }, s.revision);
    await until(() => changes > before);
    expect(changes).toBeGreaterThan(before);
    stop();
  });

  it('never delivers another user’s rows, even to an unfiltered subscription (RLS)', async () => {
    const a = await signedInUser('rt-a');
    const b = await signedInUser('rt-b');
    const seen: string[] = [];
    let ready = false;
    const ch = a.client
      .channel(`unfiltered:${a.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_settings' }, (p) => {
        seen.push((p.new as { user_id: string }).user_id);
      })
      .on('system', {}, (m: { extension?: string; status?: string }) => {
        if (m.extension === 'postgres_changes' && m.status === 'ok') ready = true;
      })
      .subscribe();
    await until(() => ready);
    expect(ready).toBe(true);

    const bs = (await b.services.settings.get(b.id))!;
    await b.services.settings.update(b.id, { theme: 'light' }, bs.revision);
    const as = (await a.services.settings.get(a.id))!;
    await a.services.settings.update(a.id, { theme: 'light' }, as.revision);
    await until(() => seen.includes(a.id));

    expect(seen).toContain(a.id);
    expect(seen).not.toContain(b.id);
    await a.client.removeChannel(ch);
  });
});
