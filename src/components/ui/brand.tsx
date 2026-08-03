export function BrandMark({ size = 34 }: { size?: number }) {
  return <span
    aria-hidden
    style={{ width: size, height: size }}
    className="grid shrink-0 place-items-center rounded-[10px] bg-[var(--brand)] text-white"
  >
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z" />
    </svg>
  </span>;
}

export function Brand({ subtitle }: { subtitle?: string }) {
  return <div className="flex items-center gap-2.5">
    <BrandMark />
    <span className="min-w-0">
      <span className="block text-[15px] font-bold leading-tight tracking-[0.14em] text-[var(--brand)]">BHEALIX</span>
      {subtitle && <span className="block truncate text-[11px] text-[var(--muted)]">{subtitle}</span>}
    </span>
  </div>;
}
