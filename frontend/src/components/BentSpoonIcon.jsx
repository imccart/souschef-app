export default function BentSpoonIcon({ size = 24, active = false, onClick }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        flexShrink: 0,
        transform: active ? 'rotate(-30deg)' : 'rotate(0deg)',
        transition: 'transform 0.3s ease',
      }}
    >
      <path d="M12 3c-2.5 0-4.5 2-4.5 4.5 0 2 1.2 3.5 3 4.2V15" />
      <path d="M12 3c2.5 0 4.5 2 4.5 4.5 0 2-1.2 3.5-3 4.2" />
      <path d="M13.5 15c0 0 1.5 2 1 4.5c-.3 1.5-1.5 2-2.5 2s-2.2-.5-2.5-2c-.5-2.5 1-4.5 1-4.5" />
    </svg>
  )
}
