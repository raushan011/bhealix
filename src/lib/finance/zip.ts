import { deflateRawSync } from "node:zlib";

/**
 * A ZIP archive, written by hand.
 *
 * Deliberately not a dependency. The format's stored-and-deflated subset is
 * about a hundred lines and has not changed since 1993, whereas an archiver
 * library is a supply-chain surface, a bundle-size cost and an upgrade to
 * remember — for a feature whose entire job is "put these forty PDFs in one
 * file". Everything written here is the original 2.0 shape: no ZIP64, no
 * encryption, no streaming descriptors, which is what every unzip in existence
 * reads without comment.
 *
 * Three structures, in this order:
 *
 *   local header + data   once per file, in the order they were given
 *   central directory     the same list again, with the offset of each header
 *   end of central dir    where the directory starts and how long it is
 *
 * An unzip reads the *last* one first and works backwards, which is why the
 * offsets in the middle have to be exact and why they are tracked as the parts
 * are appended rather than computed afterwards.
 */

export type ZipEntry = {
  /** The path inside the archive. Forward slashes; sub-folders are just names. */
  name: string;
  data: Uint8Array;
  /** The modified time recorded against the file. Defaults to now. */
  at?: Date;
};

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

/**
 * The general purpose bit flag, with bit 11 set.
 *
 * That bit says "the file name is UTF-8". Without it an unzip is entitled to
 * read the name as IBM Code Page 437, and an invoice filed as "Meta — August"
 * comes out of the archive with the dash mangled. Every name written here is
 * UTF-8, so the bit is always on.
 */
const UTF8_NAME = 0x0800;

/** Store, for bytes that are already compressed. Deflate for everything else. */
const STORED = 0;
const DEFLATED = 8;

/**
 * How the modified time is recorded: MS-DOS, in local time, with two-second
 * resolution and an epoch of 1980.
 *
 * Genuinely how the format works, and there is no alternative field that every
 * unzip reads. Anything before 1980 is clamped rather than allowed to underflow
 * into a date the archive claims is in the future.
 */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** The checksum every unzip verifies each file against before handing it over. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A name that no unzip will refuse and no filesystem will reject.
 *
 * Two separate hazards. The first is ordinary: colons, quotes and slashes are
 * illegal in a Windows file name, and a vendor's invoice number contains them
 * often enough. The second is not ordinary at all — a leading slash or a `..`
 * segment in an archive entry is the path traversal that writes outside the
 * folder somebody extracted into, and while nothing here builds such a name
 * from user input without passing through this function, that is precisely the
 * kind of guarantee that should be enforced rather than remembered.
 */
export function safeEntryName(name: string): string {
  const cleaned = name
    .split("/")
    // A run of illegal characters collapses to one dash rather than to one dash
    // each: `INV:2026*"?.pdf` should read `INV-2026-.pdf`, not `INV-2026---.pdf`.
    .map(part => part.replace(/[\\:*?"<>|]+/g, "-").replace(/^\.+$/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("/");
  return cleaned.slice(0, 180) || "file";
}

/**
 * The same name made unique within one archive.
 *
 * Two invoices from one vendor in one month routinely arrive with the same file
 * name, and a ZIP with two identical entries extracts as one file — silently,
 * with the second overwriting the first. The suffix goes before the extension so
 * the file still opens by double-click.
 */
export function uniqueEntryName(name: string, taken: Set<string>): string {
  const safe = safeEntryName(name);
  if (!taken.has(safe.toLowerCase())) {
    taken.add(safe.toLowerCase());
    return safe;
  }

  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  for (let attempt = 2; ; attempt++) {
    const candidate = `${stem} (${attempt})${extension}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

/**
 * Already-compressed bytes, which deflate can only make bigger.
 *
 * A PDF's content streams and a JPEG are both deflated already; running them
 * through it again spends CPU to add a few bytes of framing. Stored is the
 * honest answer for those and deflate for everything else — and the archive is
 * mostly PDFs, so this is most of it.
 */
const alreadyCompressed = (name: string) => /\.(pdf|jpe?g|png|webp|zip|gz)$/i.test(name);

/** One entry's bytes, as they will sit in the archive. */
function compress(name: string, data: Uint8Array): { method: number; body: Buffer } {
  if (alreadyCompressed(name) || data.length < 64) return { method: STORED, body: Buffer.from(data) };
  const body = deflateRawSync(data);
  // Deflate is not guaranteed to shrink anything. If it has not, store it.
  return body.length < data.length ? { method: DEFLATED, body } : { method: STORED, body: Buffer.from(data) };
}

/**
 * The archive, as one buffer.
 *
 * Held in memory rather than streamed, which is the right trade at this size: a
 * month of vendor invoices is a few dozen PDFs and rarely ten megabytes, and the
 * route that serves it wants a `content-length` so the browser can show a real
 * progress bar rather than an indeterminate spinner. The caller is expected to
 * have capped what it passes in — see `lib/finance/archive`.
 */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const { method, body } = compress(entry.name, entry.data);
    const { time, date } = dosStamp(entry.at ?? new Date());
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);            // version needed to extract: 2.0
    local.writeUInt16LE(UTF8_NAME, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);            // no extra field
    locals.push(local, name, body);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(CENTRAL_SIG, 0);
    directory.writeUInt16LE(20, 4);        // version made by
    directory.writeUInt16LE(20, 6);        // version needed
    directory.writeUInt16LE(UTF8_NAME, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(time, 12);
    directory.writeUInt16LE(date, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(entry.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);        // extra length
    directory.writeUInt16LE(0, 32);        // comment length
    directory.writeUInt16LE(0, 34);        // disk number
    directory.writeUInt16LE(0, 36);        // internal attributes
    directory.writeUInt32LE(0, 38);        // external attributes
    directory.writeUInt32LE(offset, 42);   // where this file's local header is
    central.push(directory, name);

    offset += local.length + name.length + body.length;
  }

  const directorySize = central.reduce((total, part) => total + part.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(0, 4);                 // this disk
  end.writeUInt16LE(0, 6);                 // disk the directory starts on
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);           // the directory begins where the files end
  end.writeUInt16LE(0, 20);                // no archive comment

  return Buffer.concat([...locals, ...central, end]);
}
