import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '@/App';
import { AppRoutes } from '@/routes';
import { createFakeBackend, type FakeBackend, type FakeOptions } from './fakeServices';

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

/** Render the whole app at `path` with an in-memory backend (signed-in owner by default). */
export function renderApp(path = '/', options: FakeOptions & { backend?: FakeBackend } = {}) {
  const backend = options.backend ?? createFakeBackend(options);
  const user = userEvent.setup();
  const queryClient = createTestQueryClient();
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders services={backend.services} queryClient={queryClient}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
  return { user, backend, queryClient, ...utils };
}

/** Render a workspace route and wait until the gated application shell is on screen. */
export async function renderWorkspace(path = '/', options: FakeOptions & { backend?: FakeBackend; sample?: boolean } = {}) {
  if (options.sample) localStorage.setItem('tp-sample-data', 'on');
  const result = renderApp(path, options);
  await screen.findAllByRole('navigation', { name: 'Primary' });
  return result;
}
