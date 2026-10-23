import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { cn } from './cn';
import { transition } from './motion';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. Defaults to 6s. */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastInput, 'description'>> {
  id: number;
  description?: string;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

const toneStyles: Record<ToastTone, { icon: typeof Info; className: string; label: string }> = {
  info: { icon: Info, className: 'text-info', label: 'Information' },
  success: { icon: CheckCircle2, className: 'text-positive', label: 'Success' },
  warning: { icon: TriangleAlert, className: 'text-warning', label: 'Warning' },
  error: { icon: XCircle, className: 'text-negative', label: 'Error' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const item: ToastItem = { id, tone: 'info', duration: 6000, ...input };
      setToasts((all) => [...all.slice(-2), item]);
      window.setTimeout(() => dismiss(id), item.duration);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-4 bottom-4 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
        style={{ zIndex: 'var(--z-toast)' }}
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const tone = toneStyles[t.tone];
            const Icon = tone.icon;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: transition.base }}
                exit={{ opacity: 0, scale: 0.98, transition: transition.fast }}
                role="status"
                className="bg-raised border-line shadow-lg pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-3.5 pr-2.5"
              >
                <Icon className={cn('mt-0.5 size-[18px] shrink-0', tone.className)} aria-label={tone.label} />
                <div className="min-w-0 flex-1">
                  <p className="text-fg text-sm font-medium">{t.title}</p>
                  {t.description && <p className="text-fg-2 mt-0.5 text-sm">{t.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="text-fg-3 hover:text-fg hover:bg-raised-hover -my-0.5 rounded-md p-1 transition-colors"
                  aria-label="Dismiss notification"
                >
                  <X className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
