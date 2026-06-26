/**
 * Marca Noir: badge con degradado rojo sangre y glifo de shuffle en negro.
 * SVG vectorial → nítido a cualquier tamaño.
 */
export default function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Noir">
      <defs>
        <linearGradient id="noir-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff3346" />
          <stop offset="1" stopColor="#7a0606" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#noir-grad)" />
      <g
        transform="translate(4 4)"
        stroke="#0c0606"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M16 3h5v5" />
        <path d="M4 20 21 3" />
        <path d="M21 16v5h-5" />
        <path d="M15 15 21 21" />
        <path d="M4 4 9 9" />
      </g>
    </svg>
  );
}
