import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface FilterBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  children?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/** Search + filter controls in a single row above a list. */
export function FilterBar({ query, onQueryChange, placeholder, children, trailing, className }: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="search">
      <div className="relative min-w-0 flex-1 basis-60 sm:max-w-sm">
        <Search className="text-fg-3 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="bg-sunken border-line hover:border-line-strong focus:border-accent text-fg placeholder:text-fg-3 h-10 w-full rounded-md border pr-9 pl-9 text-sm transition-colors outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="text-fg-3 hover:text-fg absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-1"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {children}
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}
