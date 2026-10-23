import type { Transition, Variants } from 'motion/react';

/**
 * Motion tokens. Common UI transitions stay in the 150–300ms range so motion
 * supports comprehension without making the user wait for content.
 */
export const duration = {
  fast: 0.15,
  base: 0.22,
  slow: 0.3,
} as const;

export const ease = {
  standard: [0.22, 1, 0.36, 1],
  outExpo: [0.16, 1, 0.3, 1],
} as const;

export const transition = {
  fast: { duration: duration.fast, ease: ease.standard } satisfies Transition,
  base: { duration: duration.base, ease: ease.standard } satisfies Transition,
  slow: { duration: duration.slow, ease: ease.outExpo } satisfies Transition,
  spring: { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 } satisfies Transition,
};

/** Route-level enter animation: a short fade with a small rise. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: transition.base },
};

/** Parent for staggered entrances (dashboard). */
export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transition.slow },
};
