import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenu } from 'radix-ui';
import { Keyboard, LogIn, Moon, Settings, Sun, UserRound } from 'lucide-react';
import { Dialog, Tooltip } from '@/components/ui';
import { usePreferences } from '@/lib/preferences';

const itemClass =
  'text-fg-2 data-[highlighted]:bg-raised-hover data-[highlighted]:text-fg flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm outline-none select-none ' +
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-fg-3';

const shortcuts = [
  { keys: ['Ctrl / ⌘', 'K'], label: 'Open search' },
  { keys: ['/'], label: 'Open search (when not typing)' },
  { keys: ['Esc'], label: 'Close menus and dialogs' },
  { keys: ['Tab'], label: 'Move between controls' },
];

export function UserMenu() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = usePreferences();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <>
      <DropdownMenu.Root>
        <Tooltip content="Personal workspace">
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Personal workspace menu"
              className="border-line bg-raised hover:border-line-strong data-[state=open]:border-line-strong ml-1 flex size-9 items-center justify-center rounded-full border transition-colors active:scale-95"
            >
              <UserRound className="text-fg-2 size-4" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            style={{ zIndex: 'var(--z-popover)' }}
            className="bg-raised border-line shadow-lg data-[state=open]:animate-fade-in w-64 rounded-xl border p-1.5"
          >
            <div className="px-2.5 pt-1.5 pb-2.5">
              <p className="text-fg text-sm font-medium">Personal workspace</p>
              <p className="text-fg-3 text-xs">Local preview · not signed in</p>
            </div>
            <DropdownMenu.Separator className="bg-line-soft -mx-1.5 my-1 h-px" />
            <DropdownMenu.Item className={itemClass} onSelect={() => navigate('/settings')}>
              <Settings /> Settings
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={toggleTheme}>
              {theme === 'dark' ? <Sun /> : <Moon />} {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={() => setShortcutsOpen(true)}>
              <Keyboard /> Keyboard shortcuts
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="bg-line-soft -mx-1.5 my-1 h-px" />
            <DropdownMenu.Item className={itemClass} disabled>
              <LogIn /> Sign in
              <span className="text-fg-3 ml-auto text-xs">Later phase</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Keyboard shortcuts" size="sm">
        <ul className="divide-line-soft divide-y">
          {shortcuts.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 py-2.5">
              <span>{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="bg-sunken border-line text-fg-2 rounded-sm border px-1.5 py-0.5 font-mono text-xs">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
