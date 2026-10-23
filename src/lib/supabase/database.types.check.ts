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

// Rows keep the precise generated shape.
export const g: T['audit_events']['Row']['metadata'] = { fields: ['theme'] };
