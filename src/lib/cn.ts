import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge about the custom type scale so `text-md` is treated as
// a font size (not a colour) and overrides resolve predictably.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['2xs', 'md'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
