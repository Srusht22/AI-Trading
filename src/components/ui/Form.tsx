import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Switch as S } from 'radix-ui';
import { ChevronDown, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

const controlBase =
  'w-full rounded-md border bg-sunken text-fg placeholder:text-fg-3 text-sm transition-[border-color,box-shadow,background-color] duration-150 ' +
  'border-line hover:border-line-strong focus:outline-none focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--tp-accent)_18%,transparent)] ' +
  'disabled:opacity-60 disabled:cursor-not-allowed aria-[invalid=true]:border-negative';

interface FormFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Extra element shown beside the label (e.g. an InfoTip). */
  labelAddon?: ReactNode;
  optional?: boolean;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
  className?: string;
}

/** Label + control + hint + validation message, wired together for assistive tech. */
export function FormField({ label, hint, error, labelAddon, optional, children, className }: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-fg text-sm font-medium">
          {label}
        </label>
        {labelAddon}
        {optional && <span className="text-fg-3 ml-auto text-xs">Optional</span>}
      </div>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-fg-3 text-xs leading-relaxed">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-negative flex items-center gap-1.5 text-xs font-medium" role="alert">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; trailing?: ReactNode }>(
  function Input({ className, leading, trailing, ...props }, ref) {
    if (!leading && !trailing) return <input ref={ref} className={cn(controlBase, 'h-10 px-3', className)} {...props} />;
    return (
      <div className="relative">
        {leading && <span className="text-fg-3 pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm">{leading}</span>}
        <input ref={ref} className={cn(controlBase, 'h-10', leading ? 'pl-9' : 'pl-3', trailing ? 'pr-14' : 'pr-3', className)} {...props} />
        {trailing && <span className="text-fg-3 pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">{trailing}</span>}
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(controlBase, 'min-h-28 resize-y px-3 py-2.5 leading-relaxed', className)} {...props} />;
});

/** Native select: fully accessible and uses the platform picker on mobile. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(controlBase, 'h-10 appearance-none pr-9 pl-3', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="text-fg-3 pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" aria-hidden />
    </div>
  );
});

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  addon?: ReactNode;
}

/** Labelled on/off switch row. */
export function Switch({ checked, onCheckedChange, label, description, disabled, addon }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="text-fg text-sm font-medium">
            {label}
          </label>
          {addon}
        </div>
        {description && (
          <p id={`${id}-d`} className="text-fg-3 mt-0.5 text-xs leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <S.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-d` : undefined}
        className={cn(
          'border-line bg-line-soft relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors',
          'data-[state=checked]:bg-accent data-[state=checked]:border-transparent disabled:opacity-50',
        )}
      >
        <S.Thumb className="bg-fg-2 data-[state=checked]:bg-accent-ink block size-4.5 translate-x-0.5 rounded-full shadow-sm transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
      </S.Root>
    </div>
  );
}
