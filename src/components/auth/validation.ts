import { z } from 'zod';

export const emailSchema = z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.').max(254);

/** Mirrors the auth server policy (supabase/config.toml: length 10, upper, lower, digit). */
export const newPasswordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(72, 'Use 72 characters or fewer.')
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Include upper- and lower-case letters and a number.');

export function firstIssue(result: z.ZodSafeParseResult<unknown>): string | undefined {
  return result.success ? undefined : result.error.issues[0]?.message;
}
