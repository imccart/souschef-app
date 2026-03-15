export default function ApronIcon({ size = 24, active = false, onClick }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        flexShrink: 0,
        opacity: active ? 1 : 0.7,
        transition: 'opacity 0.2s ease',
      }}
    >
      {/* Neck strap */}
      <path d="M9.5 3 C9.5 1.5 10.5 1 12 1 C13.5 1 14.5 1.5 14.5 3" />
      {/* Bib */}
      <path d="M8 7 L8 3.5 C8 3 9 2.5 12 2.5 C15 2.5 16 3 16 3.5 L16 7" />
      {/* Body */}
      <path d="M5 7 L8 7 L8 3.5 M16 3.5 L16 7 L19 7 L19 20 C19 21.5 18 22.5 16.5 22.5 L7.5 22.5 C6 22.5 5 21.5 5 20 Z" />
      {/* Waist ties */}
      <path d="M5 12 L2.5 11.5" />
      <path d="M19 12 L21.5 11.5" />
      {/* Pocket */}
      <rect x="9" y="14" width="6" height="4" rx="0.8" />
    </svg>
  )
}
