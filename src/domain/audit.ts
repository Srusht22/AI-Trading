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
  'agent.registered': { title: 'Agent registered', describe: () => 'A worker agent was registered by trusted tooling.' },
  'agent.pairing_created': { title: 'Pairing code created', describe: () => 'A one-time code to pair an MT5 connector was created.' },
  'agent.paired': { title: 'Connector paired', describe: () => 'A connector on your computer paired with this workspace (read-only MT5 access).' },
  'agent.revoked': { title: 'Agent revoked', describe: () => 'An agent’s key was revoked; it can no longer send data.' },
  'connector.verified': { title: 'Demo account verified', describe: () => 'MetaTrader 5 reported a demo account; data publication started.' },
  'connector.blocked': { title: 'Connection blocked', describe: (e) => blockReason(e) },
  'connector.symbols_selected': { title: 'Symbols selected', describe: (e) => `Monitoring: ${listOf(e, 'symbols') || 'none'}.` },
  'connector.disconnected': { title: 'Data feed disconnected', describe: () => 'You disconnected the MT5 data feed.' },
  'connector.resumed': { title: 'Data feed reconnected', describe: (e) => (e.metadata.new_account ? 'Reconnected with a new demo account; earlier account data was removed.' : 'Reconnected; the account is verified again.') },
  'task.submitted': { title: 'Task requested', describe: (e) => `Requested ${String(e.metadata.task_type ?? 'a task')}.` },
  'task.succeeded': { title: 'Task finished', describe: (e) => `${String(e.metadata.task_type ?? 'A task')} completed.` },
  'task.failed': { title: 'Task failed', describe: (e) => `${String(e.metadata.task_type ?? 'A task')} failed.` },
  'task.cancel_requested': { title: 'Task cancelled', describe: (e) => `Cancellation requested for ${String(e.metadata.task_type ?? 'a task')}.` },
};

function listOf(e: AuditEvent, key: string): string {
  const v = e.metadata[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(', ') : '';
}

function blockReason(e: AuditEvent): string {
  return e.metadata.reason === 'account_changed'
    ? 'The terminal switched to a different account than the one approved.'
    : 'MetaTrader 5 reported an account that is not a demo account.';
}

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
