import type { ReactNode } from 'react';

export function Icon({
  name = 'pulse',
  size = 20,
  ...props
}: {
  name?: string;
  size?: number;
  className?: string;
}) {
  const paths: Record<string, ReactNode> = {
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18" />
      </>
    ),
    server: (
      <>
        <rect x="4" y="3" width="16" height="7" rx="2" />
        <rect x="4" y="14" width="16" height="7" rx="2" />
        <path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m14 5-7 7 7 7M7 12h14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    edit: (
      <>
        <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z" />
      </>
    ),
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8z" />,
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
  };
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.pulse}
    </svg>
  );
}
