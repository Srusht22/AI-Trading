import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * TradePilot mark: a rising route through three waypoints — price movement,
 * an algorithm's decision graph and a navigation path in a single line.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={cn('shrink-0', className)}>
      <defs>
        <linearGradient id={`${id}-g`} x1="5" y1="27" x2="27" y2="5" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--tp-accent)" />
          <stop offset="1" stopColor="var(--tp-accent-2)" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="var(--tp-raised)" stroke="var(--tp-line)" />
      <path d="M8 24h16" stroke="var(--tp-line-strong)" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M7.5 20.5 12.75 15.5 16.75 18.75 24.25 10"
        stroke={`url(#${id}-g)`}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12.75" cy="15.5" r="1.6" fill="var(--tp-raised)" stroke="var(--tp-accent)" strokeWidth="1.3" />
      <circle cx="16.75" cy="18.75" r="1.6" fill="var(--tp-raised)" stroke="var(--tp-accent)" strokeWidth="1.3" />
      <circle cx="24.25" cy="10" r="2.6" fill="var(--tp-accent-2)" />
      <circle cx="24.25" cy="10" r="4.6" stroke="var(--tp-accent-2)" strokeOpacity="0.35" strokeWidth="1" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-fg text-[15px] font-semibold tracking-[-0.015em] whitespace-nowrap', className)}>
      TradePilot <span className="brand-text">AI</span>
    </span>
  );
}
