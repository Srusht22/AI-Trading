import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Construction } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';

export interface PreviewNotice {
  /** What the user tried to do, e.g. "Run Backtest". */
  title: string;
  /** What will happen once the capability exists. */
  body: ReactNode;
  /** What did NOT happen, stated plainly. */
  notDone?: string;
  /** What is needed first, e.g. "A connected MT5 terminal". */
  requires?: string;
}

const PreviewNoticeContext = createContext<((n: PreviewNotice) => void) | null>(null);

/**
 * Single, consistent explanation for controls whose real behaviour belongs
 * to a later phase. Makes it explicit that nothing was executed.
 */
export function PreviewNoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<PreviewNotice | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((n: PreviewNotice) => {
    setNotice(n);
    setOpen(true);
  }, []);

  return (
    <PreviewNoticeContext.Provider value={show}>
      {children}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={notice ? `${notice.title} — coming in a later phase` : ''}
        icon={
          <span className="bg-accent-2-soft text-accent-2 flex size-9 items-center justify-center rounded-lg">
            <Construction className="size-[18px]" aria-hidden />
          </span>
        }
        description={notice?.body}
      >
        {notice && (
          <dl className="bg-sunken border-line-soft space-y-2.5 rounded-lg border p-3.5">
            <div>
              <dt className="eyebrow">What happened</dt>
              <dd className="text-fg mt-0.5">{notice.notDone ?? 'Nothing was run, sent or saved. This is a design preview.'}</dd>
            </div>
            {notice.requires && (
              <div>
                <dt className="eyebrow">Needed first</dt>
                <dd className="text-fg-2 mt-0.5">{notice.requires}</dd>
              </div>
            )}
          </dl>
        )}
      </Dialog>
    </PreviewNoticeContext.Provider>
  );
}

export function usePreviewNotice() {
  const ctx = useContext(PreviewNoticeContext);
  if (!ctx) throw new Error('usePreviewNotice must be used inside <PreviewNoticeProvider>');
  return ctx;
}
