/**
 * Client-facing database types.
 *
 * The schema comes from database.generated.ts (machine-generated, verified
 * against the live database by `npm run db:types:check`). The generator
 * describes tables, not privileges, so its Insert/Update types list every
 * column. Here they are narrowed to the columns the `authenticated` role is
 * actually GRANTed, so code that tries to write an ownership, revision or
 * timestamp column — or any audit event — fails to compile.
 *
 * WRITABLE_COLUMNS is checked against information_schema.column_privileges by
 * tests/integration/types.test.ts, so it cannot silently drift from the
 * migration's GRANT statements.
 */
import type { Database as Generated, Json } from './database.generated';

export type { Json };

export const WRITABLE_COLUMNS = {
  profiles: {
    insert: ['display_name', 'id'],
    update: ['display_name'],
  },
  user_settings: {
    insert: [
      'date_format',
      'display_currency',
      'notification_preferences',
      'number_format',
      'show_beginner_help',
      'theme',
      'timezone',
      'user_id',
    ],
    update: ['date_format', 'display_currency', 'notification_preferences', 'number_format', 'show_beginner_help', 'theme', 'timezone'],
  },
  audit_events: { insert: [], update: [] },
  // Phase 3 queue: read-only for clients; writes go through submit_task / cancel_task.
  task_types: { insert: [], update: [] },
  tasks: { insert: [], update: [] },
  task_attempts: { insert: [], update: [] },
  agents: { insert: [], update: [] },
} as const;

/**
 * Functions the browser may call. agent_* and admin_* are executable only by
 * service_role (the agent API and trusted scripts), so they are left out of
 * the client type entirely.
 */
type ServerOnlyFunction = `agent_${string}` | `admin_${string}`;

type GenTables = Generated['public']['Tables'];
type Writable = typeof WRITABLE_COLUMNS;

type Narrowed<T extends keyof GenTables & keyof Writable> = Omit<GenTables[T], 'Insert' | 'Update'> & {
  Insert: Writable[T]['insert'] extends readonly [] ? never : Pick<GenTables[T]['Insert'], Writable[T]['insert'][number] & keyof GenTables[T]['Insert']>;
  Update: Writable[T]['update'] extends readonly [] ? never : Pick<GenTables[T]['Update'], Writable[T]['update'][number] & keyof GenTables[T]['Update']>;
};

export type Database = Omit<Generated, 'public'> & {
  public: Omit<Generated['public'], 'Tables' | 'Functions'> & {
    Tables: {
      profiles: Narrowed<'profiles'>;
      user_settings: Narrowed<'user_settings'>;
      audit_events: Narrowed<'audit_events'>;
      task_types: Narrowed<'task_types'>;
      tasks: Narrowed<'tasks'>;
      task_attempts: Narrowed<'task_attempts'>;
      agents: Narrowed<'agents'>;
    };
    Functions: Omit<Generated['public']['Functions'], Extract<keyof Generated['public']['Functions'], ServerOnlyFunction>>;
  };
};
