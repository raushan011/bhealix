/**
 * Renders every PWA icon from one vector source so the brand stays in sync.
 *
 * Run with `npm run icons` after changing BRAND or the glyph. The PNGs are
 * committed, so a normal build never needs this script.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const BRAND = "#73461f";
/** The heart from <BrandMark />, drawn on a 24x24 grid. */
const GLYPH = "M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z";
const STROKE = 2.4;
/**
 * The heart only occupies x 5-19 / y 7-21 of its grid, so it is centred on that
 * box (grown by half a stroke) rather than on the grid, or it renders small and
 * sitting low.
 */
const GLYPH_CENTER = { x: 12, y: 14 };
const GLYPH_SPAN = 14 + STROKE;

/**
 * @param glyphRatio how much of the canvas the heart spans. Maskable icons get
 *   a smaller glyph so nothing important falls outside the 80% safe zone.
 * @param cornerRatio 0 for full-bleed art the platform masks itself.
 */
function svg({ glyphRatio, cornerRatio }) {
  const size = 512;
  const scale = (size * glyphRatio) / GLYPH_SPAN;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * cornerRatio}" fill="${BRAND}"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(${-GLYPH_CENTER.x} ${-GLYPH_CENTER.y})">
    <path d="${GLYPH}" fill="none" stroke="#ffffff" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const ANY = svg({ glyphRatio: 0.56, cornerRatio: 0.22 });
const MASKABLE = svg({ glyphRatio: 0.42, cornerRatio: 0 });
const APPLE = svg({ glyphRatio: 0.54, cornerRatio: 0 });

const TARGETS = [
  ["icon-192.png", ANY, 192],
  ["icon-512.png", ANY, 512],
  ["maskable-192.png", MASKABLE, 192],
  ["maskable-512.png", MASKABLE, 512],
  ["apple-touch-icon.png", APPLE, 180],
  ["favicon-32.png", ANY, 32]
];

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "icon.svg"), ANY);
await writeFile(join(OUT, "maskable.svg"), MASKABLE);

for (const [name, source, size] of TARGETS) {
  await sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toFile(join(OUT, name));
  console.log(`wrote icons/${name}`);
}
