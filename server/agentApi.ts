/**
 * Agent protocol endpoint: POST /api/agent/<action>
 *
 * Agents (the diagnostics worker today, the Windows MT5 connector later)
 * authenticate with their own bearer token — never a user session and never
 * a Supabase key. This handler validates the request, hashes the token and
 * calls the matching service-role-only database function, which re-checks
 * the agent, its capabilities and its lease. No endpoint hands out work to a
 * caller without a valid, unrevoked agent token.
 */
import { z } from 'zod';
import { apiError, ok, type ApiErrorCode } from './http';
import { isJwt, resolveServerEnv, type ServerEnv } from './env';

// Workers forbid eval; stop zod 4 from probing `new Function` for its JIT.
z.config({ jitless: true });

export const MAX_BODY_BYTES = 8 * 1024;
export const AGENT_TOKEN_PATTERN = /^tpa_[A-Za-z0-9_-]{43}$/;

const uuid = z.string().uuid();
const lease = { task_id: uuid, lease_token: uuid };
const capability = z.string().regex(/^[a-z][a-z0-9_.]{0,59}$/);

const schemas = {
  heartbeat: z
    .object({
      agent_version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
      capabilities: z.array(capability).max(20),
      platform: z.string().min(1).max(60).optional(),
    })
    .strict(),
  claim: z.object({}).strict(),
  start: z.object(lease).strict(),
  renew: z
    .object({
      ...lease,
      progress_percent: z.number().int().min(0).max(100).optional(),
      progress_message: z.string().min(1).max(200).optional(),
    })
    .strict(),
  complete: z.object({ ...lease, result: z.record(z.string(), z.unknown()) }).strict(),
  fail: z
    .object({
      ...lease,
      error: z
        .object({
          code: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
          message: z.string().min(1).max(300),
          retryable: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  'ack-cancel': z.object(lease).strict(),
} as const;

export type AgentAction = keyof typeof schemas;
export const AGENT_ACTIONS = Object.keys(schemas) as AgentAction[];

type Body<A extends AgentAction> = z.infer<(typeof schemas)[A]>;

function rpcCall<A extends AgentAction>(action: A, body: Body<A>, tokenHash: string): { fn: string; args: Record<string, unknown> } {
  const b = body as Record<string, unknown>;
  const leaseArgs = { p_token_sha256: tokenHash, p_task_id: b.task_id, p_lease_token: b.lease_token };
  switch (action) {
    case 'heartbeat':
      return {
        fn: 'agent_heartbeat',
        args: { p_token_sha256: tokenHash, p_agent_version: b.agent_version, p_capabilities: b.capabilities, p_platform: b.platform ?? null },
      };
    case 'claim':
      return { fn: 'agent_claim', args: { p_token_sha256: tokenHash } };
    case 'start':
      return { fn: 'agent_start_task', args: leaseArgs };
    case 'renew':
      return {
        fn: 'agent_renew_lease',
        args: { ...leaseArgs, p_progress_percent: b.progress_percent ?? null, p_progress_message: b.progress_message ?? null },
      };
    case 'complete':
      return { fn: 'agent_complete_task', args: { ...leaseArgs, p_result: b.result } };
    case 'fail': {
      const e = b.error as { code: string; message: string; retryable: boolean };
      return { fn: 'agent_fail_task', args: { ...leaseArgs, p_error_code: e.code, p_error_message: e.message, p_retryable: e.retryable } };
    }
    case 'ack-cancel':
      return { fn: 'agent_ack_cancel', args: leaseArgs };
  }
  throw new Error('unreachable');
}

/** PostgreSQL errors raised by the agent_* functions → HTTP. */
const DB_ERRORS: Record<string, [number, ApiErrorCode, string]> = {
  TPA01: [401, 'unauthorized', 'Agent token not recognised or revoked.'],
  TPA02: [409, 'heartbeat_required', 'Send a heartbeat before claiming work.'],
  TPL01: [409, 'lease_lost', 'This agent no longer holds the task (lease expired, re-assigned or finished).'],
  TPS01: [409, 'invalid_state', 'The task is not in a state that allows this action.'],
  TPV01: [422, 'validation_failed', 'The request was rejected by the database validation rules.'],
};

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AgentApiDeps {
  fetch?: typeof fetch;
}

export async function handleAgentRequest(request: Request, rawEnv: ServerEnv, action: string, deps: AgentApiDeps = {}): Promise<Response> {
  if (!(AGENT_ACTIONS as string[]).includes(action)) return apiError(404, 'not_found', 'Unknown agent action.');
  if (request.method !== 'POST') return apiError(405, 'method_not_allowed', 'Use POST.', { Allow: 'POST' });

  const env = resolveServerEnv(rawEnv);
  if (!env) return apiError(503, 'server_misconfigured', 'The agent API is not configured on this deployment.');

  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!AGENT_TOKEN_PATTERN.test(token)) {
    return apiError(401, 'unauthorized', 'A valid agent token is required.', { 'WWW-Authenticate': 'Bearer' });
  }

  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
    return apiError(415, 'unsupported_media_type', 'Send application/json.');
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) return apiError(413, 'payload_too_large', `Request bodies are limited to ${MAX_BODY_BYTES} bytes.`);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return apiError(413, 'payload_too_large', `Request bodies are limited to ${MAX_BODY_BYTES} bytes.`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    return apiError(400, 'bad_request', 'The body is not valid JSON.');
  }
  const typedAction = action as AgentAction;
  const parsed = schemas[typedAction].safeParse(parsedJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    return apiError(422, 'validation_failed', `The request body is not valid${where}.`);
  }

  const tokenHash = await sha256Hex(token);
  const { fn, args } = rpcCall(typedAction, parsed.data as Body<typeof typedAction>, `\\x${tokenHash}`);
  const headers: Record<string, string> = {
    apikey: env.secretKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (isJwt(env.secretKey)) headers.Authorization = `Bearer ${env.secretKey}`;

  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
  } catch {
    return apiError(503, 'upstream_unavailable', 'The database could not be reached. Retry with backoff.');
  }

  const payload = (await upstream.json().catch(() => null)) as { code?: string } | unknown;
  if (upstream.ok) return ok(payload ?? null);

  const code = (payload as { code?: string } | null)?.code ?? '';
  const mapped = DB_ERRORS[code];
  if (mapped) return apiError(mapped[0], mapped[1], mapped[2]);
  if (upstream.status === 429) return apiError(429, 'rate_limited', 'Too many requests. Retry with backoff.');
  // Anything else is a server-side problem; details stay in the database logs.
  return apiError(502, 'upstream_unavailable', 'The database rejected the request unexpectedly. Retry with backoff.');
}
