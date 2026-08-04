/**
 * Renders every app icon from the BHEALIX logo so the brand stays in sync.
 *
 * Run with `npm run icons` after replacing assets/brand/bhealix-logo.png. The
 * output is committed, so a normal build never runs this.
 *
 * The wordmark is deliberately dropped from the icons. "BHEALIX" sits about a
 * fifteenth of the artwork's height, which is under two pixels on a favicon and
 * still a smudge on a home screen — the monogram is the part that survives.
 * The full lockup is emitted separately for places with room to show it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "assets", "brand", "bhealix-logo.png");
const ICONS = join(ROOT, "public", "icons");
const BRAND_DIR = join(ROOT, "public", "brand");

/** Sampled from the artwork rather than guessed, so the ring matches the mark. */
const GOLD = "#c0a058";
/** --surface-2. Warmer than paper white and it stops the mark floating on light launchers. */
const PAPER = "#fdf6e8";

/** Where the B sits inside the 1254px square, measured off the source. */
const MONOGRAM = { left: 410, top: 276, width: 449, height: 523 };

/**
 * The logo is flat art on white, so luminance alone separates mark from paper.
 * Feathering the cut across a narrow band keeps the anti-aliased curves smooth
 * instead of leaving them jagged the way a hard threshold would.
 */
async function cutout(region) {
  const { data, info } = await sharp(SOURCE).extract(region).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });

  const OPAQUE = 236, CLEAR = 252;
  for (let i = 0; i < data.length; i += info.channels) {
    const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
    data[i + 3] = luminance <= OPAQUE ? 255
      : luminance >= CLEAR ? 0
      : Math.round(255 * (CLEAR - luminance) / (CLEAR - OPAQUE));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png().toBuffer();
}

/**
 * @param span how much of the canvas the monogram covers. Maskable icons get
 *   less, because Android crops to a circle and only the middle 80% is safe.
 * @param ring draw the logo's circle. Skipped where it would not survive:
 *   a favicon renders it as a muddy hairline, and a maskable crop eats it.
 */
function backdrop({ size, radius, ring }) {
  const circle = ring
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.445}" fill="none" stroke="${GOLD}" stroke-width="${Math.max(1, size * 0.016)}"/>`
    : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" rx="${size * radius}" fill="${PAPER}"/>
      ${circle}
    </svg>`
  );
}

async function icon({ size, span, radius = 0, ring = false }, monogram) {
  // The mark is taller than it is wide, so height drives the fit.
  const height = Math.round(size * span);
  const width = Math.round(height * (MONOGRAM.width / MONOGRAM.height));
  const mark = await sharp(monogram).resize(width, height).toBuffer();

  return sharp(backdrop({ size, radius, ring }))
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

await mkdir(ICONS, { recursive: true });
await mkdir(BRAND_DIR, { recursive: true });

const monogram = await cutout(MONOGRAM);
// The full square, trimmed of its margin — ring, monogram and wordmark intact.
const lockup = await cutout({ left: 20, top: 20, width: 1214, height: 1214 });

await writeFile(join(BRAND_DIR, "monogram.png"), await sharp(monogram).resize({ height: 512 }).png({ compressionLevel: 9 }).toBuffer());
await writeFile(join(BRAND_DIR, "logo.png"), await sharp(lockup).resize(512, 512).png({ compressionLevel: 9 }).toBuffer());

/*
 * Spans are set against the ring, not the canvas: the ring spans 0.89, so 0.46
 * leaves the monogram roughly the same breathing room inside the circle that it
 * has in the artwork. Ringless icons can afford to run larger.
 */
const TARGETS = [
  ["icon-192.png", { size: 192, span: 0.46, radius: 0.22, ring: true }],
  ["icon-512.png", { size: 512, span: 0.46, radius: 0.22, ring: true }],
  ["maskable-192.png", { size: 192, span: 0.52 }],
  ["maskable-512.png", { size: 512, span: 0.52 }],
  ["apple-touch-icon.png", { size: 180, span: 0.48, ring: true }],
  ["favicon-32.png", { size: 32, span: 0.78 }]
];

for (const [name, spec] of TARGETS) {
  await writeFile(join(ICONS, name), await icon(spec, monogram));
  console.log(`wrote icons/${name}`);
}
console.log("wrote brand/monogram.png, brand/logo.png");
