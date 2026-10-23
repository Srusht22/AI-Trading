import { useId, type ReactNode } from 'react';
import { Tabs as T, ToggleGroup } from 'radix-ui';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { transition } from '@/lib/motion';

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  count?: number;
}

interface TabsProps<V extends string> {
  value: V;
  onValueChange: (v: V) => void;
  items: TabItem<V>[];
  children?: ReactNode;
  label: string;
  className?: string;
}

/** Underlined tabs with an animated active indicator. */
export function Tabs<V extends string>({ value, onValueChange, items, children, label, className }: TabsProps<V>) {
  const id = useId();
  return (
    <T.Root value={value} onValueChange={(v) => onValueChange(v as V)} className={className}>
      <T.List aria-label={label} className="border-line-soft -mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {items.map((item) => (
          <T.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'text-fg-3 hover:text-fg-2 data-[state=active]:text-fg relative flex h-10 shrink-0 items-center gap-1.5 px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-offset-[-2px]',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="bg-line-soft text-fg-2 num rounded-xs px-1.5 text-xs">{item.count}</span>
            )}
            {value === item.value && (
              <motion.span
                layoutId={`tab-indicator-${id}`}
                transition={transition.spring}
                className="bg-accent absolute inset-x-2 -bottom-px h-0.5 rounded-full"
              />
            )}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}

export const TabPanel = T.Content;

interface SegmentedProps<V extends string> {
  value: V;
  onValueChange: (v: V) => void;
  options: { value: V; label: ReactNode; ariaLabel?: string }[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Compact single-choice control (timeframes, view modes). */
export function SegmentedControl<V extends string>({ value, onValueChange, options, label, size = 'sm', className }: SegmentedProps<V>) {
  const id = useId();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as V)}
      aria-label={label}
      className={cn('bg-sunken border-line-soft inline-flex rounded-md border p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          className={cn(
            'text-fg-3 hover:text-fg-2 data-[state=on]:text-fg relative inline-flex items-center justify-center gap-1.5 rounded-sm font-medium transition-colors [&_svg]:size-4',
            size === 'sm' ? 'h-7 min-w-9 px-2.5 text-xs' : 'h-8 min-w-10 px-3 text-sm',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              transition={transition.spring}
              className="bg-raised border-line shadow-sm absolute inset-0 rounded-sm border"
            />
          )}
          <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
