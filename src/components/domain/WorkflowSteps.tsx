import { Check, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { staggerContainer, staggerItem } from '@/lib/motion';

export interface WorkflowStep {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Marks steps that always require a human decision. */
  human?: boolean;
}

/** Horizontal (desktop) / vertical (mobile) pipeline of stages. */
export function WorkflowSteps({ steps, current }: { steps: WorkflowStep[]; current: number }) {
  return (
    <motion.ol
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8"
    >
      {steps.map((s, i) => {
        const Icon = s.icon;
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        return (
          <motion.li
            key={s.id}
            variants={staggerItem}
            className={cn(
              'relative rounded-lg border p-3.5',
              state === 'current' ? 'border-[color-mix(in_srgb,var(--tp-accent)_45%,transparent)] bg-accent-soft' : 'border-line-soft bg-sunken',
            )}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'done' && 'bg-accent text-accent-ink',
                  state === 'current' && 'border-accent text-accent border-2',
                  state === 'upcoming' && 'border-line text-fg-3 border',
                )}
              >
                {state === 'done' ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
              </span>
              <Icon className={cn('size-4', state === 'upcoming' ? 'text-fg-3' : 'text-accent')} aria-hidden />
              {s.human && (
                <span className="text-warning ml-auto text-2xs font-semibold tracking-wide uppercase">You decide</span>
              )}
            </div>
            <p className={cn('mt-2.5 text-sm font-medium', state === 'upcoming' ? 'text-fg-2' : 'text-fg')}>{s.label}</p>
            <p className="text-fg-3 mt-0.5 text-xs leading-relaxed">{s.description}</p>
            <span className="sr-only">{state === 'done' ? '(completed)' : state === 'current' ? '(current stage)' : '(not started)'}</span>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}
