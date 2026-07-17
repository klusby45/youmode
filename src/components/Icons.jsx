// Inline stroke icons — 24×24, inherit color via currentColor.
const P = {
  dumbbell: <><path d="M6.5 6.5l11 11" /><path d="M3 8l2-2M8 3l-2 2" /><rect x="1.5" y="6.5" width="4" height="6" rx="1" transform="rotate(45 3.5 9.5)" /><rect x="18.5" y="11.5" width="4" height="6" rx="1" transform="rotate(45 20.5 14.5)" /></>,
  run: <><circle cx="13" cy="4.5" r="1.6" /><path d="M5 13l3-2 2.5 1.5L9 16l2 5" /><path d="M11 9l3 2 1 3 3 1" /><path d="M4 21l2-3" /></>,
  plate: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /></>,
  meal: <><path d="M8 3v4a2 2 0 0 0 4 0V3" /><path d="M10 3v4" /><path d="M10 7v14" /><path d="M15.5 3c-1.6 1-1.6 5.2 0 6.2V21" /></>,
  book: <><path d="M4 5.5A1.5 1.5 0 015.5 4H19v15H6a2 2 0 00-2 2z" /><path d="M4 19.5A1.5 1.5 0 015.5 18H19" /></>,
  camera: <><path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z" /><circle cx="12" cy="12.5" r="3.2" /></>,
  drop: <path d="M12 3s6 6.5 6 10.5a6 6 0 11-12 0C6 9.5 12 3 12 3z" />,
  check: <path d="M4 12.5l5 5 11-11" />,
  x: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  flame: <path d="M12 3c1 3-2 4-2 7a2 2 0 104 0c0-1 0-1.5-.5-2.5C16 9 17 12 17 14a5 5 0 11-10 0c0-4 5-5 5-11z" />,
  trophy: <><path d="M7 4h10v4a5 5 0 01-10 0z" /><path d="M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3" /><path d="M12 13v4M9 20h6M10 17h4" /></>,
  gavel: <><path d="M14 3l7 7-2.5 2.5L11.5 5.5z" /><path d="M9 8l4 4-6 6-4-4z" /><path d="M3 21h8" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  logout: <><path d="M14 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4" /><path d="M10 12h9M16 9l3 3-3 3" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  today: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /><path d="M9 14l2 2 4-4" /></>,
  versus: <><path d="M5 4l5 8-5 8M19 4l-5 8 5 8" /></>,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>,
  scissors: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8 7.5L20 18M8 16.5L20 6" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0" /><path d="M12 18v3M8.5 21h7" /></>,
  crown: <><path d="M4 17.5h16" /><path d="M4 17.5L2.8 8.5l5.2 3.7L12 5.5l4 6.7 5.2-3.7-1.2 9" /></>,
  sparkle: <path d="M12 3.5l1.9 5.3 5.3 1.9-5.3 1.9L12 17.9l-1.9-5.3-5.3-1.9 5.3-1.9z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none" />,
  upload: <><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>,
  expand: <><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M9 20H4v-5" /><path d="M15 20h5v-5" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></>,
}

export default function Icon({ name, size = 22, strokeWidth = 1.9, fill = 'none', style, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {P[name] || null}
    </svg>
  )
}
