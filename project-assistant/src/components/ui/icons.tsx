/**
 * Icon set.
 *
 * Authored rather than pulled from a library so every glyph shares one optical
 * size, one 1.5 stroke, and one round cap. Mixing two icon families is the
 * fastest way to make a considered interface look assembled.
 */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export const ArrowUp = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 19V5" />
    <path d="m5.5 11.5 6.5-6.5 6.5 6.5" />
  </svg>
);

export const Stop = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

export const Plus = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Copy = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
  </svg>
);

export const Check = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export const Retry = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M20 11a8 8 0 1 0-2.1 6.1" />
    <path d="M20 4.5V11h-6.5" />
  </svg>
);

export const ChevronRight = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </svg>
);

export const Alert = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.75v4.75M12 16.1h.01" />
  </svg>
);

export const Menu = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);

export const Close = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);
