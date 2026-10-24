/**
 * Compile-time assertions for the privilege-aware database types.
 * Checked by `tsc -b`; never imported at runtime. If any forbidden write
 * becomes allowed, the matching @ts-expect-error turns into a build error.
 */
import type { Database } from './database.types';

type T = Database['public']['Tables'];

export const allowed: [T['profiles']['Update'], T['user_settings']['Update'], T['profiles']['Insert']] = [
  { display_name: 'Ana' },
  { theme: 'light', timezone: 'UTC', notification_preferences: { backtests: true } },
  { id: '00000000-0000-0000-0000-000000000000' },
];

// @ts-expect-error — profile ownership column is not updatable
export const a: T['profiles']['Update'] = { id: 'x' };
// @ts-expect-error — timestamps are server-controlled
export const b: T['profiles']['Update'] = { updated_at: 'x' };
// @ts-expect-error — revision is server-controlled
export const c: T['user_settings']['Update'] = { revision: 2 };
// @ts-expect-error — settings ownership column is not updatable
export const d: T['user_settings']['Update'] = { user_id: 'x' };
// @ts-expect-error — audit events cannot be inserted by clients
export const e: T['audit_events']['Insert'] = { event_type: 'x.y', resource_type: 'x' };
// @ts-expect-error — audit events cannot be updated by clients
export const f: T['audit_events']['Update'] = { event_type: 'x.y' };

// @ts-expect-error — tasks are created only through submit_task()
export const h: T['tasks']['Insert'] = { task_type: 'system.health_check' };
// @ts-expect-error — task status cannot be written by clients
export const i: T['tasks']['Update'] = { status: 'succeeded' };
// @ts-expect-error — agents are registered only by trusted tooling
export const j: T['agents']['Insert'] = { display_name: 'x' };

type F = Database['public']['Functions'];
export const k: keyof F = 'submit_task';
// @ts-expect-error — the agent protocol is not callable from the browser
export const l: keyof F = 'agent_claim';
// @ts-expect-error — administration is not callable from the browser
export const m: keyof F = 'admin_register_agent';

// @ts-expect-error — account data is written only by the connector
export const n: T['mt5_account_state']['Insert'] = { equity: 1 };
// @ts-expect-error — publishing is not callable from the browser
export const o: keyof F = 'mt5_publish';
export const p: keyof F = 'create_agent_pairing';

// Rows keep the precise generated shape.
export const g: T['audit_events']['Row']['metadata'] = { fields: ['theme'] };
