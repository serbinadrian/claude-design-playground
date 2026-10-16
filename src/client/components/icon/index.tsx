import type { ReactNode } from 'react';

// Stroke glyphs from the Lucide set (ISC), the icon family the Singularity
// Compute design system uses. Inlined so they inherit `currentColor`.
const GLYPHS = {
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  ellipsis: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  ),
  square: <rect height="18" rx="2" width="18" x="3" y="3" />,
  'rotate-ccw': (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

export const Icon = ({ name, size = 16 }: { name: IconName; size?: number }) => (
  <svg
    aria-hidden="true"
    className="icon"
    fill="none"
    focusable="false"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    width={size}
  >
    {GLYPHS[name]}
  </svg>
);
