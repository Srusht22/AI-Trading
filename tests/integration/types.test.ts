import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { WRITABLE_COLUMNS } from '@/lib/supabase/database.types';

/**
 * The client types narrow Insert/Update to WRITABLE_COLUMNS. This test proves
 * that list is exactly what the database GRANTs the `authenticated` role, so
 * the types can never promise a write the database would refuse (or hide one
 * it allows).
 */
const url = process.env.DATABASE_URL;
if (!url) console.warn('[integration] DATABASE_URL not set — grant/type consistency test is SKIPPED, not passed.');

describe.skipIf(!url)('database types match the real column privileges', () => {
  const client = new pg.Client({ connectionString: url });
  beforeAll(() => client.connect());
  afterAll(() => client.end());

  async function granted(table: string, privilege: 'INSERT' | 'UPDATE', role: string) {
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = $1 and grantee = $2 and privilege_type = $3
        order by column_name`,
      [table, role, privilege],
    );
    return rows.map((r) => r.column_name);
  }

  for (const table of Object.keys(WRITABLE_COLUMNS) as (keyof typeof WRITABLE_COLUMNS)[]) {
    it(`${table}: authenticated INSERT/UPDATE columns equal the typed list`, async () => {
      expect(await granted(table, 'INSERT', 'authenticated')).toEqual([...WRITABLE_COLUMNS[table].insert].sort());
      expect(await granted(table, 'UPDATE', 'authenticated')).toEqual([...WRITABLE_COLUMNS[table].update].sort());
    });
  }

  it('anon has no write privileges on any public table', async () => {
    for (const table of Object.keys(WRITABLE_COLUMNS)) {
      expect(await granted(table, 'INSERT', 'anon')).toEqual([]);
      expect(await granted(table, 'UPDATE', 'anon')).toEqual([]);
    }
  });

  it('owner, agent credential and lease tables are not in the API-exposed schema', async () => {
    const { rows } = await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name in ('app_owner', 'agent_credentials', 'task_leases')`,
    );
    expect(rows).toHaveLength(0);
  });
});
