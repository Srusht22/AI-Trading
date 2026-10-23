import { describe, expect, it } from 'vitest';
import { readPublicConfig, isPrivilegedKey } from '@/lib/env';
import { fromAuthError, fromPostgrestError, redact } from '@/lib/errors';
import { deriveFreshness } from '@/domain/freshness';
import { formatDateTime } from '@/lib/datetime';
import { settingsPatchSchema } from '@/domain/settings';
import { parseEquityPoints, priceBarSchema } from '@/domain/marketData';

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.c2lnbmF0dXJl`;

describe('public configuration', () => {
  it('accepts a URL and publishable key', () => {
    const r = readPublicConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') });
    expect(r).toEqual({ ok: true, config: { supabaseUrl: 'https://abc.supabase.co', supabasePublishableKey: jwt('anon') } });
  });

  it('reports missing configuration instead of falling back to fake data', () => {
    const r = readPublicConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(' ')).toMatch(/VITE_SUPABASE_URL is not set/);
  });

  it('refuses a privileged key in browser configuration', () => {
    expect(isPrivilegedKey(jwt('service_role'))).toBe(true);
    expect(isPrivilegedKey('sb_secret_abcdefghijklmnop')).toBe(true);
    expect(isPrivilegedKey(jwt('anon'))).toBe(false);
    const r = readPublicConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('service_role') });
    expect(r.ok).toBe(false);
  });
});

describe('error mapping', () => {
  it.each([
    [{ code: '42501', message: 'permission denied' }, 403, 'authorization'],
    [{ code: '23505', message: 'duplicate key' }, 409, 'conflict'],
    [{ code: '23514', message: 'violates check constraint' }, 400, 'validation'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 401, 'session_expired'],
    [{ code: '', message: 'TypeError: Failed to fetch' }, 0, 'network'],
    [{ code: 'XX000', message: 'internal' }, 503, 'unavailable'],
  ])('maps PostgREST %o (HTTP %s) to %s', (error, status, kind) => {
    const e = fromPostgrestError(error, 'save your settings', status);
    expect(e.kind).toBe(kind);
    expect(e.userMessage).not.toMatch(/constraint|duplicate key|JWT|PGRST|permission denied/);
  });

  it('maps auth errors to friendly messages that do not reveal account existence', () => {
    expect(fromAuthError({ code: 'invalid_credentials', status: 400 }).userMessage).toBe('The email or password is incorrect.');
    expect(fromAuthError({ code: 'over_request_rate_limit', status: 429 }).kind).toBe('rate_limited');
    expect(fromAuthError({ name: 'AuthRetryableFetchError', status: 0 }).kind).toBe('network');
    expect(fromAuthError({ code: 'signup_disabled', status: 422 }).userMessage).toMatch(/registrations are closed/);
  });

  it('redacts tokens and passwords from development logs', () => {
    const text = redact(`{"access_token":"abc.def","password":"hunter2","key":"${jwt('service_role')}"}`);
    expect(text).not.toMatch(/hunter2|abc\.def|eyJ/);
  });
});

describe('data freshness', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  it('is live only when connected and recent', () => {
    expect(deriveFreshness({ connected: true, lastUpdateAt: '2026-10-23T11:59:50Z', staleAfterMs: 30_000, now }).state).toBe('live');
  });
  it('is stale when connected but quiet', () => {
    expect(deriveFreshness({ connected: true, lastUpdateAt: '2026-10-23T11:50:00Z', staleAfterMs: 30_000, now }).state).toBe('stale');
    expect(deriveFreshness({ connected: true, lastUpdateAt: null, staleAfterMs: 30_000, now })).toEqual({ state: 'stale', lastUpdateAt: null });
  });
  it('is disconnected when the source is down, regardless of last data', () => {
    expect(deriveFreshness({ connected: false, lastUpdateAt: '2026-10-23T11:59:59Z', staleAfterMs: 30_000, now }).state).toBe('disconnected');
  });
});

describe('time display', () => {
  it('renders UTC timestamps in the chosen zone and always labels the zone', () => {
    const iso = '2026-07-01T12:00:00Z';
    expect(formatDateTime(iso, { timeZone: 'UTC', dateFormat: 'iso', locale: 'en-US' })).toBe('2026-07-01, 12:00 UTC');
    expect(formatDateTime(iso, { timeZone: 'Asia/Tokyo', dateFormat: 'dmy', locale: 'en-GB' })).toBe('01/07/2026, 21:00 GMT+9');
  });
});

describe('input validation', () => {
  it('rejects invalid settings before they reach the network', () => {
    expect(settingsPatchSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ user_id: 'x' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ display_currency: 'EUR', timezone: 'Europe/Paris' }).success).toBe(true);
  });

  it('validates future market-data payloads strictly', () => {
    expect(() => parseEquityPoints([{ t: 1, equity: Number.NaN, balance: 1 }])).toThrow();
    expect(priceBarSchema.safeParse({ t: 1, symbol: 'EURUSD', timeframe: 'H1', open: 1.1, high: 1.0, low: 1.05, close: 1.08 }).success).toBe(false);
  });
});
