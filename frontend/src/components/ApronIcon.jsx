export default function ApronIcon({ size = 36, active = false, onClick }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="#8B6F5E"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        flexShrink: 0,
        padding: Math.max(0, (44 - size) / 2),
        opacity: active ? 1 : 0.7,
        transition: 'opacity 0.2s ease',
      }}
    >
      {/* Apron body - simplified from Noun Project SVG */}
      <path
        d="M35 25 C35 18 42 12 50 12 C58 12 65 18 65 25 L65 35 L75 45 L75 82 C75 86 72 88 68 88 L32 88 C28 88 25 86 25 82 L25 45 L35 35 Z"
        fill="#FAF7F2"
      />
      {/* Neck strap */}
      <path d="M40 12 C40 8 45 5 50 5 C55 5 60 8 60 12" fill="none" />
      {/* Waist ties */}
      <path d="M25 50 L15 48" fill="none" />
      <path d="M75 50 L85 48" fill="none" />
      {/* Pocket */}
      <rect x="38" y="55" width="24" height="16" rx="3" fill="none" />
    </svg>
  )
}
