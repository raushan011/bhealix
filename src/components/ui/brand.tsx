import Image from "next/image";

/**
 * The B monogram, lifted from the logo by `npm run icons`.
 *
 * Only the monogram appears here, never the full lockup: this sits at 30px in
 * the app bars, where the circle and the wordmark would collapse into noise.
 * `Brand` sets the wordmark as live text beside it instead, which stays crisp
 * at any size and can be read by anything that reads the page.
 */
export function BrandMark({ size = 34 }: { size?: number }) {
  return <Image
    src="/brand/monogram.png"
    alt=""
    aria-hidden
    width={size}
    height={size}
    priority
    // `brand-mark` is what the monochrome palette greys out — it is raster
    // artwork, so it is the one thing on screen the colour tokens cannot reach.
    className="brand-mark shrink-0 object-contain"
    style={{ width: size, height: size }}
  />;
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
