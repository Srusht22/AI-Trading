import { z } from 'zod';

export const auditEventSchema = z.object({
  id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  event_type: z.string(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

export const AUDIT_COLUMNS = 'id, actor_user_id, event_type, resource_type, resource_id, metadata, created_at';

/** Human-readable descriptions for the event types the database emits. */
export const auditEventLabels: Record<string, { title: string; describe: (e: AuditEvent) => string }> = {
  'account.created': { title: 'Account created', describe: () => 'Your TradePilot account was registered.' },
  'account.email_confirmed': { title: 'Email confirmed', describe: () => 'Your email address was verified.' },
  'auth.session_started': { title: 'Signed in', describe: () => 'A new session was started.' },
  'auth.session_ended': { title: 'Signed out', describe: () => 'A session was ended.' },
  'auth.password_changed': { title: 'Password changed', describe: () => 'Your account password was changed.' },
  'profile.updated': { title: 'Profile updated', describe: (e) => `Changed: ${fieldList(e)}.` },
  'settings.updated': { title: 'Settings updated', describe: (e) => `Changed: ${fieldList(e)}.` },
  'owner.assigned': { title: 'Workspace owner assigned', describe: () => 'Owner access was granted by a trusted administrator.' },
};

const fieldNames: Record<string, string> = {
  display_name: 'display name',
  theme: 'theme',
  display_currency: 'display currency',
  timezone: 'timezone',
  date_format: 'date format',
  number_format: 'number format',
  show_beginner_help: 'beginner explanations',
  notification_preferences: 'notifications',
};

function fieldList(e: AuditEvent): string {
  const fields = Array.isArray(e.metadata.fields) ? (e.metadata.fields as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  return fields.length ? fields.map((f) => fieldNames[f] ?? f).join(', ') : 'details';
}

export function describeAuditEvent(e: AuditEvent) {
  const known = auditEventLabels[e.event_type];
  return known ? { title: known.title, detail: known.describe(e) } : { title: e.event_type, detail: 'Recorded event.' };
}
