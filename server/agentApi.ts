/**
 * Agent protocol endpoint: POST /api/agent/<action>
 *
 * Agents (the diagnostics worker and the Windows MT5 connector) authenticate
 * with their own bearer token — never a user session and never a Supabase key.
 * `pair` is the one exception to "token already registered": the connector
 * presents the token it just generated plus an owner-issued one-time pairing
 * code, and the database registers the token's hash only if the code is valid. This handler validates the request, hashes the token and
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
/** mt5-publish carries symbol pages and bar batches; everything else stays small. */
export const MAX_PUBLISH_BODY_BYTES = 512 * 1024;
export const AGENT_TOKEN_PATTERN = /^tpa_[A-Za-z0-9_-]{43}$/;

const uuid = z.string().uuid();
const lease = { task_id: uuid, lease_token: uuid };
const capability = z.string().regex(/^[a-z][a-z0-9_.]{0,59}$/);
const version = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);
const num = z.number().finite();
const price = num.min(0).max(1e12);
const money = num.min(-1e15).max(1e15);
const isoUtc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/);
const symbolName = z.string().regex(/^[A-Za-z0-9._#+&!$@-]{1,32}$/);
/** Printable text: control characters are refused (the database applies the same rule). */
const shortText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => ![...v].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127), 'control characters are not allowed');
const ticket = z.number().int().min(1).max(9e18);

/** The connector's verification report (see mt5_report_connection). */
const mt5Report = z
  .object({
    state: z.enum(['ok', 'terminal_unavailable', 'not_logged_in', 'account_unavailable', 'broker_disconnected', 'unsupported_terminal']),
    connector_version: version,
    terminal_build: z.number().int().min(1).max(1_000_000).nullable().optional(),
    terminal_connected: z.boolean().nullable().optional(),
    trade_mode: z.enum(['demo', 'contest', 'real', 'unknown']).optional(),
    trade_mode_code: z.number().int().min(-1).max(100).nullable().optional(),
    account_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    masked_account: z.string().regex(/^\*{4}[0-9]{1,4}$/).optional(),
    server: shortText(64).optional(),
    company: shortText(128).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3,6}$/).optional(),
    currency_digits: z.number().int().min(0).max(8).optional(),
    leverage: z.number().int().min(1).max(100000).nullable().optional(),
    broker_utc_offset_minutes: z.number().int().min(-840).max(840).nullable().optional(),
    broker_offset_source: z.enum(['estimated', 'configured', 'unknown']).optional(),
  })
  .strict();

const publishData = {
  account: z
    .object({
      balance: money,
      credit: money,
      equity: money,
      profit: money,
      margin: num.min(0).max(1e15),
      margin_free: money,
      margin_level: num.min(0).max(1e12).nullable(),
      currency: z.string().regex(/^[A-Z]{3,6}$/),
      currency_digits: z.number().int().min(0).max(8),
      leverage: z.number().int().min(1).max(100000).nullable(),
      observed_at: isoUtc,
    })
    .strict(),
  quotes: z
    .object({
      observed_at: isoUtc,
      quotes: z
        .array(z.object({ symbol: symbolName, bid: price, ask: price, last: price.nullable(), tick_time: isoUtc }).strict())
        .max(8),
    })
    .strict(),
  symbols: z
    .object({
      batch_id: z.string().uuid(),
      page: z.number().int().min(0).max(100),
      final: z.boolean(),
      symbols: z
        .array(
          z
            .object({
              name: symbolName,
              description: shortText(128).nullable(),
              path: shortText(128).nullable(),
              digits: z.number().int().min(0).max(10),
              point: num.positive().max(1e6),
              currency_base: shortText(12).nullable(),
              currency_profit: shortText(12).nullable(),
              trade_mode: z.number().int().min(0).max(4).nullable(),
              visible: z.boolean(),
            })
            .strict(),
        )
        .max(1000),
    })
    .strict(),
  bars: z
    .object({
      symbol: symbolName,
      timeframe: z.enum(['M1', 'M5', 'M15', 'H1']),
      bars: z
        .array(
          z
            .object({
              open_time: isoUtc,
              open: price,
              high: price,
              low: price,
              close: price,
              tick_volume: z.number().int().min(0).nullable(),
              real_volume: num.min(0).nullable(),
              spread: z.number().int().min(0).nullable(),
            })
            .strict(),
        )
        .max(1000),
    })
    .strict(),
  positions: z
    .object({
      observed_at: isoUtc,
      positions: z
        .array(
          z
            .object({
              ticket,
              symbol: symbolName,
              side: z.enum(['buy', 'sell']),
              volume: num.min(0).max(1e9),
              price_open: price,
              price_current: price.nullable(),
              stop_loss: price.nullable(),
              take_profit: price.nullable(),
              profit: money,
              swap: money,
              opened_at: isoUtc,
            })
            .strict(),
        )
        .max(200),
    })
    .strict(),
  orders: z
    .object({
      observed_at: isoUtc,
      orders: z
        .array(
          z
            .object({
              ticket,
              symbol: symbolName,
              order_type: z.enum(['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop', 'buy_stop_limit', 'sell_stop_limit', 'other']),
              volume_initial: num.min(0).max(1e9),
              volume_current: num.min(0).max(1e9),
              price_open: price,
              price_stoplimit: price.nullable(),
              stop_loss: price.nullable(),
              take_profit: price.nullable(),
              placed_at: isoUtc,
            })
            .strict(),
        )
        .max(200),
    })
    .strict(),
  deals: z
    .object({
      observed_at: isoUtc,
      deals: z
        .array(
          z
            .object({
              ticket,
              order_ticket: z.number().int().min(0).max(9e18).nullable(),
              position_id: z.number().int().min(0).max(9e18).nullable(),
              symbol: z.string().regex(/^[A-Za-z0-9._#+&!$@-]{0,32}$/),
              deal_type: z.enum(['buy', 'sell', 'balance', 'credit', 'charge', 'correction', 'bonus', 'commission', 'other']),
              entry: z.enum(['in', 'out', 'inout', 'out_by']).nullable(),
              volume: num.min(0).max(1e9),
              price,
              profit: money,
              commission: money,
              swap: money,
              fee: money,
              executed_at: isoUtc,
            })
            .strict(),
        )
        .max(500),
    })
    .strict(),
} as const;

const mt5Publish = z.discriminatedUnion(
  'kind',
  (Object.keys(publishData) as (keyof typeof publishData)[]).map((kind) =>
    z
      .object({
        connection_id: z.string().uuid(),
        account_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        kind: z.literal(kind),
        data: publishData[kind],
      })
      .strict(),
  ) as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]],
);

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
  pair: z
    .object({
      pairing_code: z.string().regex(/^[0-9A-Fa-f]{4}(-?[0-9A-Fa-f]{4}){4}$/),
      agent_version: version,
      platform: z.string().min(1).max(60).optional(),
    })
    .strict(),
  'mt5-connection': mt5Report,
  'mt5-publish': mt5Publish,
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
    case 'pair':
      // p_code_sha256 is filled in by the caller (it needs an async hash).
      return { fn: 'agent_pair', args: { p_token_sha256: tokenHash, p_agent_version: b.agent_version, p_platform: b.platform ?? null } };
    case 'mt5-connection':
      return { fn: 'mt5_report_connection', args: { p_token_sha256: tokenHash, p_report: b } };
    case 'mt5-publish':
      return {
        fn: 'mt5_publish',
        args: { p_token_sha256: tokenHash, p_connection_id: b.connection_id, p_account_fingerprint: b.account_fingerprint, p_kind: b.kind, p_data: b.data },
      };
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
  TPA03: [403, 'forbidden', 'This agent may not do that (missing mt5.read capability, or not its connection).'],
  TPC01: [409, 'connection_disconnected', 'The owner disconnected this MT5 connection in the website. Publication is stopped.'],
  TPC02: [409, 'connection_blocked', 'This MT5 connection is blocked (account not verified as the approved demo account).'],
  TPC03: [409, 'verification_required', 'This MT5 connection is not verified as a demo account yet.'],
  TPR02: [429, 'rate_limited', 'Updates are arriving faster than allowed. Slow down.'],
  TPP01: [401, 'pairing_invalid', 'The pairing code is invalid, expired or already used. Create a new one in the website.'],
};

/** TPV01 messages name the offending field (never its value), which helps operators. */
const DETAILED_CODES = new Set(['TPV01']);

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
  const limit = action === 'mt5-publish' ? MAX_PUBLISH_BODY_BYTES : MAX_BODY_BYTES;
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > limit) return apiError(413, 'payload_too_large', `Request bodies are limited to ${limit} bytes.`);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) {
    return apiError(413, 'payload_too_large', `Request bodies are limited to ${limit} bytes.`);
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
  if (typedAction === 'pair') {
    const code = (parsed.data as { pairing_code: string }).pairing_code.replace(/-/g, '').toUpperCase();
    args.p_code_sha256 = `\\x${await sha256Hex(code)}`;
  }
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
  if (mapped) {
    const detail = DETAILED_CODES.has(code) ? String((payload as { message?: string }).message ?? '').slice(0, 160) : '';
    return apiError(mapped[0], mapped[1], detail ? `${mapped[2]} (${detail})` : mapped[2]);
  }
  if (upstream.status === 429) return apiError(429, 'rate_limited', 'Too many requests. Retry with backoff.');
  // Anything else is a server-side problem; details stay in the database logs.
  return apiError(502, 'upstream_unavailable', 'The database rejected the request unexpectedly. Retry with backoff.');
}
