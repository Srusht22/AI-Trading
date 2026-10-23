import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Tooltip } from './Tooltip';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'outline';
  tooltip?: ReactNode | false;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', variant = 'ghost', tooltip, tooltipSide = 'bottom', className, ...props },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        'text-fg-2 hover:text-fg relative inline-flex shrink-0 items-center justify-center rounded-md',
        'transition-[background-color,color,border-color,transform] duration-150 active:scale-95',
        'disabled:opacity-50 disabled:active:scale-100 [&_svg]:size-[18px]',
        size === 'md' ? 'size-10' : 'size-8 [&_svg]:size-4',
        variant === 'ghost' && 'hover:bg-raised-hover data-[state=open]:bg-raised-hover data-[state=open]:text-fg',
        variant === 'outline' && 'border-line bg-raised hover:bg-raised-hover border',
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={tooltip ?? label} side={tooltipSide}>
      {button}
    </Tooltip>
  );
});
