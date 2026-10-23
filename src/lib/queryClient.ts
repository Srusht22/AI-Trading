import { QueryClient } from '@tanstack/react-query';
import { isAppError } from './errors';

/** Retry reads only for transient failures; never retry writes automatically. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => count < 2 && isAppError(error) && (error.kind === 'network' || error.kind === 'unavailable'),
      },
      mutations: { retry: false },
    },
  });
}
