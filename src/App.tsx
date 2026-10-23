import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { PreferencesProvider } from '@/lib/preferences';
import { PreviewNoticeProvider } from '@/lib/previewNotice';
import { ToastProvider } from '@/lib/toast';
import { AppRoutes } from './routes';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    // reducedMotion="user" disables transform animations when the OS asks for less motion.
    <MotionConfig reducedMotion="user">
      <PreferencesProvider>
        <ToastProvider>
          <PreviewNoticeProvider>{children}</PreviewNoticeProvider>
        </ToastProvider>
      </PreferencesProvider>
    </MotionConfig>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
