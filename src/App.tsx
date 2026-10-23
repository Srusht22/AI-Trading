import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { ConfigurationRequired } from '@/components/auth/Gates';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { readPublicConfig } from '@/lib/env';
import { PreferencesProvider } from '@/lib/preferences';
import { PreviewNoticeProvider } from '@/lib/previewNotice';
import { createQueryClient } from '@/lib/queryClient';
import { ServicesProvider } from '@/lib/services-context';
import { ToastProvider } from '@/lib/toast';
import { createSupabaseServices, type Services } from '@/services';
import { AppRoutes } from './routes';

interface AppProvidersProps {
  services: Services;
  queryClient: QueryClient;
  children: ReactNode;
}

export function AppProviders({ services, queryClient, children }: AppProvidersProps) {
  return (
    // reducedMotion="user" disables transform animations when the OS asks for less motion.
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <ServicesProvider services={services}>
          <PreferencesProvider>
            <ToastProvider>
              <PreviewNoticeProvider>
                <AuthProvider>{children}</AuthProvider>
              </PreviewNoticeProvider>
            </ToastProvider>
          </PreferencesProvider>
        </ServicesProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}

const config = readPublicConfig();
const runtime = config.ok
  ? { services: createSupabaseServices(config.config, window.location.origin), queryClient: createQueryClient() }
  : null;

export function App() {
  if (!config.ok || !runtime) {
    return (
      <PreferencesProvider>
        <ConfigurationRequired problems={config.ok ? [] : config.problems} />
      </PreferencesProvider>
    );
  }
  return (
    <BrowserRouter>
      <AppProviders services={runtime.services} queryClient={runtime.queryClient}>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
