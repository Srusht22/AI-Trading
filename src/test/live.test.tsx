import { render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { LiveDataProvider } from '@/lib/live';
import { ServicesProvider } from '@/lib/services-context';
import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider';
import type { ReactNode } from 'react';
import type { LiveStatus, RealtimeService } from '@/services/types';
import { createFakeBackend } from './fakeServices';
import { createTestQueryClient } from './renderApp';

function WhenSignedIn({ children }: { children: ReactNode }) {
  return useAuth().state.status === 'signed_in' ? <>{children}</> : null;
}

describe('LiveDataProvider', () => {
  it('refetches each source when its subscription becomes live again after a disconnect', async () => {
    const backend = createFakeBackend();
    const handlers = new Map<string, (s: LiveStatus) => void>();
    const realtime: RealtimeService = {
      watchRows: ({ table, onStatus }) => {
        handlers.set(table, onStatus);
        onStatus('connecting');
        return () => {};
      },
    };
    const services = { ...backend.services, realtime };
    const qc = createTestQueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(
      <ServicesProvider services={services}>
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <WhenSignedIn>
              <LiveDataProvider>
                <span>child</span>
              </LiveDataProvider>
            </WhenSignedIn>
          </AuthProvider>
        </QueryClientProvider>
      </ServicesProvider>,
    );
    await waitFor(() => expect(handlers.has('tasks')).toBe(true));
    const tasksKey = ['tasks', backend.userId];
    const count = () => spy.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(tasksKey)).length;

    handlers.get('tasks')!('live');
    expect(count()).toBe(1);
    handlers.get('tasks')!('live'); // still live: no extra refetch
    expect(count()).toBe(1);
    handlers.get('tasks')!('unavailable'); // connection dropped
    handlers.get('tasks')!('live'); // reconnected: catch up on missed changes
    expect(count()).toBe(2);
  });
});
