import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (e.g. a router <Link>) with button styling. */
  asChild?: boolean;
  /** Only set while a real UI operation is in progress. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const base =
  'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-standard ' +
  'active:scale-[0.98] disabled:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-4 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink shadow-sm hover:bg-accent-strong ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_2px_rgb(0_0_0/0.3)]',
  secondary: 'bg-raised text-fg border border-line hover:bg-raised-hover hover:border-line-strong shadow-highlight',
  ghost: 'text-fg-2 hover:text-fg hover:bg-raised-hover',
  subtle: 'bg-accent-soft text-accent hover:bg-[color-mix(in_srgb,var(--tp-accent)_16%,transparent)]',
  danger: 'bg-negative-soft text-negative border border-[color-mix(in_srgb,var(--tp-negative)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--tp-negative)_18%,transparent)]',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', asChild, loading, leadingIcon, trailingIcon, className, children, disabled, ...props },
  ref,
) {
  const classes = cn(base, variants[variant], sizes[size], className);
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});

export const PrimaryButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(function PrimaryButton(props, ref) {
  return <Button ref={ref} variant="primary" {...props} />;
});

export const SecondaryButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(function SecondaryButton(props, ref) {
  return <Button ref={ref} variant="secondary" {...props} />;
});
