// Material Symbols icon (font loaded in index.html). Decorative: hidden from screen readers.
export default function Icon({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  return (
    <span className={`material-symbols-outlined icon ${className}`} style={{ fontSize: size }} aria-hidden>
      {name}
    </span>
  );
}
