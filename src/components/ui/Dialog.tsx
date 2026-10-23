import type { ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, type ButtonVariant } from './Button';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

/** Accessible modal: focus is trapped, Escape closes, focus returns to the trigger. */
export function Dialog({ open, onOpenChange, title, description, children, footer, icon, size = 'md' }: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay
          className="bg-overlay data-[state=open]:animate-fade-in fixed inset-0 backdrop-blur-[2px]"
          style={{ zIndex: 'var(--z-dialog)' }}
        />
        <D.Content
          style={{ zIndex: 'var(--z-dialog)' }}
          className={cn(
            'bg-raised border-line shadow-lg fixed top-1/2 left-1/2 w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border',
            'max-h-[calc(100dvh-32px)] overflow-y-auto data-[state=open]:animate-[dialog-in_220ms_var(--ease-standard)]',
            widths[size],
          )}
        >
          <div className="flex items-start gap-3.5 p-5 pb-0 sm:p-6 sm:pb-0">
            {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">
              <D.Title className="text-fg text-lg font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="text-fg-2 mt-1 text-sm leading-relaxed">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">Dialog</D.Description>
              )}
            </div>
            <D.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="text-fg-3 hover:text-fg hover:bg-raised-hover -mt-1 -mr-1 rounded-md p-1.5 transition-colors"
              >
                <X className="size-4" />
              </button>
            </D.Close>
          </div>
          {children && <div className="text-fg-2 px-5 pt-4 text-sm sm:px-6">{children}</div>}
          <div className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end sm:p-6">
            {footer ?? (
              <D.Close asChild>
                <Button variant="secondary">Close</Button>
              </D.Close>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

interface ConfirmationDialogProps extends Omit<DialogProps, 'footer'> {
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
}

export function ConfirmationDialog({
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  onOpenChange,
  ...props
}: ConfirmationDialogProps) {
  return (
    <Dialog
      {...props}
      onOpenChange={onOpenChange}
      footer={
        <>
          <D.Close asChild>
            <Button variant="secondary">{cancelLabel}</Button>
          </D.Close>
          <Button
            variant={confirmVariant}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
