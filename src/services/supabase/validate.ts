import type { ZodType } from 'zod';
import { AppError, logError } from '@/lib/errors';

/** Validate data received from the network instead of trusting TypeScript types. */
export function parseResponse<T>(schema: ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  logError(`Unexpected ${what} shape`, result.error.issues);
  throw new AppError('database', `The server returned ${what} in an unexpected format. Please reload the page.`, {
    code: 'invalid_response',
    cause: result.error,
  });
}
