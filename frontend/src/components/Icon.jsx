import React from 'react';

// Decorative SVGs share one style; the surrounding buttons and labels provide accessible names.
export default function Icon({ name }) {
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    trend: (
      <>
        <path d="M3 18 9 12l4 4 8-10" />
        <path d="M16 6h5v5" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    sidebar: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M9 4v16M5.5 8h1M5.5 11h1" />
      </>
    ),
    bars: (
      <>
        <path d="M4 5h16M4 12h11M4 19h6" />
        <circle cx="4" cy="5" r="1" />
        <circle cx="4" cy="12" r="1" />
        <circle cx="4" cy="19" r="1" />
      </>
    ),
    severity: (
      <>
        <path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7Z" />
        <path d="M12 8v5m0 3h.01" />
      </>
    ),
    pie: <><path d="M12 3v9h9A9 9 0 0 0 12 3Z" /><path d="M8 4a9 9 0 1 0 12 12h-12Z" /></>,
    map: (
      <>
        <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" />
        <path d="M9 3v15m6-12v15" />
      </>
    ),
    brand: (
      <>
        {/* Vehicle silhouette with impact burst rays representing crash analytics */}
        <path d="M3.5 13.5l2-4.5A2 2 0 0 1 7.3 7.5h6.4a2 2 0 0 1 1.8 1.4l1.8 4.6" />
        <path d="M2.5 13.5h15a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H2.5" />
        <circle cx="6" cy="18.5" r="1.5" />
        <circle cx="14" cy="18.5" r="1.5" />
        <path d="M19.5 11.5l2.5-1.5" />
        <path d="M20 14h2.5" />
        <path d="M19.5 16.5l2.5 1.5" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || null}
    </svg>
  );
}
