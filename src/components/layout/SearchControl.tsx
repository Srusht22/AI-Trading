import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from 'radix-ui';
import { BookOpen, CornerDownLeft, Eye, Moon, PanelLeft, Search, type LucideIcon } from 'lucide-react';
import { primaryNav, secondaryNav } from '@/config/navigation';
import { glossary } from '@/content/glossary';
import { usePreferences } from '@/lib/preferences';
import { useThemeControl } from '@/lib/theme';
import { cn } from '@/lib/cn';

interface Result {
  id: string;
  group: 'Pages' | 'Help topics' | 'Actions';
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Global search. Phase 1 searches a local index of pages, glossary terms and
 * UI actions only — robots, tests and logs will be added once they exist.
 */
export function SearchControl() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { sidebarCollapsed, setSidebarCollapsed, showSampleData, setShowSampleData } = usePreferences();
  const { theme, toggleTheme } = useThemeControl();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const all = useMemo<Result[]>(() => {
    const pages: Result[] = [...primaryNav, ...secondaryNav].map((n) => ({
      id: `page-${n.id}`,
      group: 'Pages',
      title: n.label,
      subtitle: n.description,
      icon: n.icon,
      keywords: [n.label, n.description, ...(n.keywords ?? [])].join(' '),
      run: () => navigate(n.path),
    }));
    const help: Result[] = Object.entries(glossary).map(([k, g]) => ({
      id: `term-${k}`,
      group: 'Help topics',
      title: g.term,
      subtitle: g.definition,
      icon: BookOpen,
      keywords: [g.term, 'short' in g ? g.short : '', g.definition].join(' '),
      run: () => navigate(`/settings?term=${k}#glossary`),
    }));
    const actions: Result[] = [
      {
        id: 'act-theme',
        group: 'Actions',
        title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        icon: Moon,
        keywords: 'theme dark light appearance mode',
        run: toggleTheme,
      },
      {
        id: 'act-sidebar',
        group: 'Actions',
        title: sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
        icon: PanelLeft,
        keywords: 'sidebar navigation collapse expand',
        run: () => setSidebarCollapsed(!sidebarCollapsed),
      },
      {
        id: 'act-sample',
        group: 'Actions',
        title: showSampleData ? 'Hide sample data' : 'Show sample data',
        subtitle: 'Toggle between labelled sample previews and empty states',
        icon: Eye,
        keywords: 'sample data preview empty demo',
        run: () => setShowSampleData(!showSampleData),
      },
    ];
    return [...pages, ...actions, ...help];
  }, [navigate, theme, toggleTheme, sidebarCollapsed, setSidebarCollapsed, showSampleData, setShowSampleData]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all.filter((r) => r.group !== 'Help topics').concat(all.filter((r) => r.group === 'Help topics').slice(0, 4));
    const words = q.split(/\s+/);
    return all.filter((r) => {
      const hay = `${r.title} ${r.keywords}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [all, query]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (r: Result | undefined) => {
    if (!r) return;
    setOpen(false);
    setQuery('');
    r.run();
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  };

  let lastGroup: string | null = null;
  const rendered: ReactNode[] = [];
  results.forEach((r, i) => {
    if (r.group !== lastGroup) {
      rendered.push(
        <li key={`g-${r.group}`} role="presentation" className="eyebrow px-3 pt-3 pb-1.5">
          {r.group}
        </li>,
      );
      lastGroup = r.group;
    }
    const Icon = r.icon;
    rendered.push(
      <li
        key={r.id}
        id={`search-opt-${i}`}
        role="option"
        aria-selected={i === active}
        data-index={i}
        onMouseMove={() => setActive(i)}
        onClick={() => choose(r)}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2',
          i === active ? 'bg-raised-hover text-fg' : 'text-fg-2',
        )}
      >
        <span className="bg-sunken border-line-soft flex size-8 shrink-0 items-center justify-center rounded-md border">
          <Icon className={cn('size-4', i === active ? 'text-accent' : 'text-fg-3')} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{r.title}</span>
          {r.subtitle && <span className="text-fg-3 block truncate text-xs">{r.subtitle}</span>}
        </span>
        {i === active && <CornerDownLeft className="text-fg-3 size-3.5 shrink-0" aria-hidden />}
      </li>,
    );
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Search"
          aria-keyshortcuts="Control+K Meta+K"
          className={cn(
            'text-fg-3 hover:text-fg-2 flex h-9 items-center gap-2 rounded-md text-sm transition-colors',
            'md:bg-sunken md:border-line md:hover:border-line-strong md:w-60 md:border md:px-3 xl:w-72',
            'max-md:hover:bg-raised-hover max-md:size-10 max-md:justify-center',
          )}
        >
          <Search className="size-[18px] shrink-0 md:size-4" aria-hidden />
          <span className="hidden flex-1 text-left md:inline">Search…</span>
          <kbd className="border-line bg-raised text-fg-3 hidden rounded-xs border px-1.5 font-sans text-[11px] md:inline">Ctrl K</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-overlay data-[state=open]:animate-fade-in fixed inset-0" style={{ zIndex: 'var(--z-dialog)' }} />
        <Dialog.Content
          aria-describedby={undefined}
          style={{ zIndex: 'var(--z-dialog)' }}
          className="bg-raised border-line shadow-lg fixed top-[12vh] left-1/2 flex max-h-[min(34rem,76vh)] w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border data-[state=open]:animate-[dialog-in_200ms_var(--ease-standard)]"
        >
          <Dialog.Title className="sr-only">Search TradePilot</Dialog.Title>
          <div className="border-line-soft flex items-center gap-3 border-b px-4">
            <Search className="text-fg-3 size-4 shrink-0" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search pages, help topics and actions"
              role="combobox"
              aria-expanded
              aria-controls="search-results"
              aria-activedescendant={results[active] ? `search-opt-${active}` : undefined}
              aria-label="Search pages, help topics and actions"
              className="text-fg placeholder:text-fg-3 h-13 flex-1 bg-transparent text-md outline-none focus-visible:outline-none"
            />
            <kbd className="border-line text-fg-3 hidden rounded-xs border px-1.5 text-[11px] sm:inline">Esc</kbd>
          </div>
          <ul ref={listRef} id="search-results" role="listbox" aria-label="Search results" className="flex-1 overflow-y-auto p-2">
            {results.length ? (
              rendered
            ) : (
              <li className="text-fg-2 px-3 py-10 text-center text-sm" role="presentation">
                No matches for “{query}”.
                <span className="text-fg-3 mt-1 block text-xs">Robots, backtests and logs become searchable once they exist.</span>
              </li>
            )}
          </ul>
          <div className="border-line-soft text-fg-3 flex items-center gap-4 border-t px-4 py-2.5 text-xs">
            <span>↑↓ to move</span>
            <span>Enter to open</span>
            <span className="ml-auto">Searches this website only</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
