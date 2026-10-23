import { CircleAlert, CircleCheck, Info, WifiOff } from 'lucide-react';
import type { AppError } from '@/lib/errors';
import { cn } from '@/lib/cn';

/** Inline status for auth forms. Announced to assistive technology. */
export function FormAlert({ error, success, info, className }: { error?: AppError | null; success?: string; info?: string; className?: string }) {
  if (!error && !success && !info) return null;
  const tone = error ? 'error' : success ? 'success' : 'info';
  const Icon = error ? (error.kind === 'network' ? WifiOff : CircleAlert) : success ? CircleCheck : Info;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm',
        tone === 'error' && 'bg-negative-soft border-[color-mix(in_srgb,var(--tp-negative)_30%,transparent)]',
        tone === 'success' && 'bg-positive-soft border-[color-mix(in_srgb,var(--tp-positive)_30%,transparent)]',
        tone === 'info' && 'bg-info-soft border-[color-mix(in_srgb,var(--tp-info)_30%,transparent)]',
        className,
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', tone === 'error' ? 'text-negative' : tone === 'success' ? 'text-positive' : 'text-info')}
        aria-hidden
      />
      <p className="text-fg">{error?.userMessage ?? success ?? info}</p>
    </div>
  );
}
