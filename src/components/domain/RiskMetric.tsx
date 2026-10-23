import type { ReactNode } from 'react';
import { InfoTip } from '@/components/ui';
import { glossary, type GlossaryEntry, type GlossaryKey } from '@/content/glossary';
import { cn } from '@/lib/cn';

interface RiskMetricProps {
  term?: GlossaryKey;
  /** Visible label; defaults to the glossary term. */
  label?: string;
  value: ReactNode;
  /** Plain-language reading of this particular value. */
  reading?: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
  className?: string;
}

const toneText = { neutral: 'text-fg', positive: 'text-positive', negative: 'text-negative', warning: 'text-warning' };

/** A single financial measure with its definition one tap away. */
export function RiskMetric({ term, label, value, reading, tone = 'neutral', className }: RiskMetricProps) {
  const g: GlossaryEntry | undefined = term ? glossary[term] : undefined;
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-fg-2 text-sm">
        {label ?? g?.term}
        {g && (
          <InfoTip className="ml-1 -mt-0.5" title={g.term} more={g.more} label={`What is ${g.term}?`}>
            {g.definition}
          </InfoTip>
        )}
      </dt>
      <dd className={cn('num mt-1 text-xl font-semibold tracking-tight', toneText[tone])}>{value}</dd>
      {reading && <dd className="text-fg-3 mt-0.5 text-xs leading-relaxed">{reading}</dd>}
    </div>
  );
}
