/**
 * Etemaro brand mark — the isometric cube/hexagon with two "eyes".
 * Geometry mirrors `assets/favicon.svg` so the console and the app icon match.
 * Strokes use `currentColor`, so the mark inherits the surrounding text colour.
 */
export function Logo({ size = 28, title = 'Etemaro' }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label={title}
      focusable="false"
      className="brand-logo"
    >
      <polygon
        points="50,15 80,30 80,65 50,80 20,65 20,30"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="20,30 50,45 80,30"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="50,45 50,80"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="35" cy="45" r="4" fill="currentColor" />
      <circle cx="65" cy="45" r="4" fill="currentColor" />
    </svg>
  )
}
