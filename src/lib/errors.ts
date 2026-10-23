/**
 * Application error taxonomy.
 *
 * Every failure that reaches the UI is an AppError with a `kind` the UI can
 * branch on and a `userMessage` written for people, not engineers. The
 * original error is kept in `cause` for development logs only.
 */
export type AppErrorKind =
  | 'validation'
  | 'auth' // wrong credentials, unconfirmed email, weak password…
  | 'session_expired'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'network'
  | 'unavailable'
  | 'database'
  | 'configuration'
  | 'unknown';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly userMessage: string;
  /** Machine-readable detail, e.g. a GoTrue error code. Never shown verbatim. */
  readonly code?: string;
  override readonly cause?: unknown;

  constructor(kind: AppErrorKind, userMessage: string, options: { code?: string; cause?: unknown } = {}) {
    super(userMessage);
    this.name = 'AppError';
    this.kind = kind;
    this.userMessage = userMessage;
    this.code = options.code;
    this.cause = options.cause;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

const NETWORK_MESSAGE = 'We couldn’t reach the TradePilot server. Check your internet connection and try again.';

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** Map a PostgREST / Postgres error. `action` completes "Unable to …". */
export function fromPostgrestError(error: PostgrestLikeError, action: string, status?: number): AppError {
  const code = error.code ?? '';
  const base = `Unable to ${action}.`;
  if (isNetworkMessage(error.message)) return new AppError('network', NETWORK_MESSAGE, { code, cause: error });
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303')
    return new AppError('session_expired', 'Your session has expired. Please sign in again.', { code, cause: error });
  if (code === '42501' || status === 403)
    return new AppError('authorization', `${base} You don’t have permission to do this.`, { code, cause: error });
  if (code === 'PGRST116') return new AppError('not_found', `${base} The record could not be found.`, { code, cause: error });
  if (code === '23505') return new AppError('conflict', `${base} It already exists.`, { code, cause: error });
  if (code === '23514' || code === '22023' || code === '22P02' || code === '23502')
    return new AppError('validation', `${base} One of the values isn’t allowed.`, { code, cause: error });
  if (status === 429) return new AppError('rate_limited', 'Too many requests. Please wait a moment and try again.', { code, cause: error });
  if (status !== undefined && status >= 500)
    return new AppError('unavailable', `${base} The server is temporarily unavailable. Please try again shortly.`, { code, cause: error });
  return new AppError('database', `${base} Please try again.`, { code, cause: error });
}

interface AuthLikeError {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
}

/** Map a Supabase Auth (GoTrue) error. Messages never confirm whether an account exists. */
export function fromAuthError(error: AuthLikeError): AppError {
  const code = error.code ?? '';
  const status = error.status;
  if (error.name === 'AuthRetryableFetchError' || isNetworkMessage(error.message) || status === 0)
    return new AppError('network', NETWORK_MESSAGE, { code, cause: error });
  switch (code) {
    case 'invalid_credentials':
      return new AppError('auth', 'The email or password is incorrect.', { code, cause: error });
    case 'email_not_confirmed':
      return new AppError('auth', 'Please confirm your email address first. Check your inbox for the confirmation link.', { code, cause: error });
    case 'weak_password':
      return new AppError('validation', 'Choose a stronger password: at least 10 characters with upper- and lower-case letters and a number.', { code, cause: error });
    case 'same_password':
      return new AppError('validation', 'Your new password must be different from the current one.', { code, cause: error });
    case 'signup_disabled':
    case 'email_provider_disabled':
      return new AppError('auth', 'New registrations are closed for this TradePilot workspace.', { code, cause: error });
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return new AppError('rate_limited', 'Too many attempts. Please wait a few minutes and try again.', { code, cause: error });
    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return new AppError('session_expired', 'Your session has expired. Please sign in again.', { code, cause: error });
    case 'flow_state_not_found':
    case 'flow_state_expired':
    case 'otp_expired':
    case 'bad_code_verifier':
      return new AppError('auth', 'This link has expired or was opened in a different browser. Request a new one.', { code, cause: error });
    case 'reauthentication_needed':
    case 'reauthentication_not_valid':
      return new AppError('auth', 'For your security, sign out and sign in again before changing your password.', { code, cause: error });
    case 'validation_failed':
    case 'email_address_invalid':
      return new AppError('validation', 'Enter a valid email address.', { code, cause: error });
  }
  if (status === 429) return new AppError('rate_limited', 'Too many attempts. Please wait a few minutes and try again.', { code, cause: error });
  if (status !== undefined && status >= 500)
    return new AppError('unavailable', 'The sign-in service is temporarily unavailable. Please try again shortly.', { code, cause: error });
  return new AppError('auth', 'We couldn’t complete that request. Please try again.', { code, cause: error });
}

export function toAppError(e: unknown, fallbackAction = 'complete that action'): AppError {
  if (isAppError(e)) return e;
  if (e instanceof TypeError && isNetworkMessage(e.message)) return new AppError('network', NETWORK_MESSAGE, { cause: e });
  return new AppError('unknown', `Unable to ${fallbackAction}. Please try again.`, { cause: e });
}

function isNetworkMessage(message?: string) {
  return !!message && /failed to fetch|networkerror|network request failed|load failed|fetch failed|ECONNREFUSED/i.test(message);
}

// -----------------------------------------------------------------------------
// Development logging. Redacts anything resembling a credential.
// -----------------------------------------------------------------------------

const SECRET_PATTERN = /(eyJ[\w-]+\.[\w-]+\.[\w-]+)|(sb_(secret|publishable)_[\w-]+)|("?(access_token|refresh_token|password|apikey|authorization)"?\s*[:=]\s*"?)[^",\s}]+/gi;

export function redact(value: string): string {
  return value.replace(SECRET_PATTERN, (_match, _jwt, _sb, _sbType, prefix) => (prefix ? `${prefix}[redacted]` : '[redacted]'));
}

export function logError(context: string, error: unknown) {
  if (!import.meta.env.DEV) return;
  const detail = isAppError(error) ? { kind: error.kind, code: error.code, cause: error.cause } : error;
  let text: string;
  try {
    text = JSON.stringify(detail, Object.getOwnPropertyNames(detail ?? {}));
  } catch {
    text = String(detail);
  }
  console.error(`[TradePilot] ${context}:`, redact(text));
}
