import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { formatMoney } from "./constants";
import { amountInWords } from "./gst";
import { formatDate } from "@/lib/time";
import type { SellerSettings } from "./invoices";
import type { InvoiceRecord } from "./types";

/**
 * The bill as an actual PDF file.
 *
 * The print sheet renders the same document in HTML, and for a long time that
 * was the whole of "download": open it, press print, choose Save as PDF. That
 * is three deliberate steps and a printer dialog in place of a file, and on a
 * phone it frequently ends with a bill sent to a real printer. Pressing
 * Download now returns bytes.
 *
 * Drawn rather than converted from the HTML: a headless browser is a hundred
 * megabytes of Chromium and several seconds per bill, where the layout of an
 * A4 invoice is a dozen boxes and a table. `pdf-lib` is pure JavaScript, so
 * this runs anywhere the rest of the app does.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 34;
const WIDTH = PAGE.width - MARGIN * 2;
/** Kept clear at the foot of every page so nothing is drawn into the edge. */
const FOOT = 24;

const INK = rgb(0.11, 0.11, 0.12);
const MUTED = rgb(0.42, 0.42, 0.44);
const LINE = rgb(0.6, 0.6, 0.62);
const SHADE = rgb(0.94, 0.94, 0.95);
const DANGER = rgb(0.75, 0.13, 0.13);

/**
 * The standard fonts encode Windows-1252 and nothing else, and pdf-lib throws
 * on the first character outside it rather than dropping it. The rupee sign is
 * the one this document is guaranteed to meet — it is in every money figure —
 * so it becomes "Rs.", which is what an Indian invoice said before the glyph
 * existed. Anything else unencodable becomes a space rather than an exception:
 * a bill with one odd character missing still beats no bill at all.
 */
const CP1252_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function safe(value: unknown): string {
  return String(value ?? "")
    .replace(/₹\s?/g, "Rs. ")
    // Printable Latin-1, plus the newlines that hold a multi-line address apart.
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, character =>
      CP1252_EXTRAS.includes(character) ? character : " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Money as the sheet prints it: the app's formatting with the sign spelled out. */
const money = (amount: number) => safe(formatMoney(amount));

const lineHeightOf = (size: number) => size * 1.34;

type TextOptions = {
  x: number; top: number; size: number; width?: number;
  bold?: boolean; color?: RGB; align?: "left" | "right" | "center";
};

/** A run of text in a stacked block — a party address, a note, a heading. */
type Run = { text: string; size?: number; bold?: boolean; color?: RGB; gap?: number; align?: "left" | "right" | "center" };

/**
 * The page under the cursor. `y` is the top of whatever comes next and only
 * ever moves down, so every section is written in the order it is read.
 */
class Sheet {
  page!: PDFPage;
  y = 0;

  constructor(readonly doc: PDFDocument, readonly regular: PDFFont, readonly heavy: PDFFont) {
    this.turn();
  }

  turn() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }

  /** Turns the page when `height` will not fit below the cursor. */
  room(height: number) {
    if (this.y - height < MARGIN + FOOT) this.turn();
  }

  font(bold?: boolean) { return bold ? this.heavy : this.regular; }

  wrap(value: string, size: number, width: number, bold?: boolean): string[] {
    const font = this.font(bold);
    const lines: string[] = [];

    for (const paragraph of safe(value).split("\n")) {
      let current = "";
      for (const word of paragraph.split(" ").filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) { current = candidate; continue; }
        if (current) { lines.push(current); current = ""; }
        // A single word wider than the column — a long product code, an email —
        // is cut rather than allowed to run out over the border beside it.
        const pieces = this.chop(word, size, width, bold);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1];
      }
      lines.push(current);
    }
    return lines.length ? lines : [""];
  }

  private chop(word: string, size: number, width: number, bold?: boolean): string[] {
    const font = this.font(bold);
    const pieces: string[] = [];
    let piece = "";
    for (const character of word) {
      if (piece && font.widthOfTextAtSize(piece + character, size) > width) { pieces.push(piece); piece = character; }
      else piece += character;
    }
    return piece ? [...pieces, piece] : pieces.length ? pieces : [""];
  }

  measure(lines: number, size: number) { return lines * lineHeightOf(size); }

  /** Draws pre-wrapped lines from `top` downwards and returns the height used. */
  text(lines: string[], options: TextOptions): number {
    const font = this.font(options.bold);
    const step = lineHeightOf(options.size);
    lines.forEach((line, index) => {
      const width = font.widthOfTextAtSize(line, options.size);
      const box = options.width ?? 0;
      const x = options.align === "right" ? options.x + box - width
        : options.align === "center" ? options.x + (box - width) / 2
        : options.x;
      this.page.drawText(line, {
        x, y: options.top - step * (index + 1) + options.size * 0.3,
        size: options.size, font, color: options.color ?? INK
      });
    });
    return step * lines.length;
  }

  /** One string, wrapped to `width` and drawn. */
  paragraph(value: string, options: TextOptions & { width: number }): number {
    return this.text(this.wrap(value, options.size, options.width, options.bold), options);
  }

  blockHeight(runs: Run[], width: number): number {
    return runs.reduce((total, run) => {
      const size = run.size ?? 8.5;
      return total + (run.gap ?? 0) + this.measure(this.wrap(run.text, size, width, run.bold).length, size);
    }, 0);
  }

  block(runs: Run[], x: number, top: number, width: number): number {
    let y = top;
    for (const run of runs) {
      const size = run.size ?? 8.5;
      y -= run.gap ?? 0;
      y -= this.paragraph(run.text, { x, top: y, size, width, bold: run.bold, color: run.color, align: run.align });
    }
    return top - y;
  }

  box(x: number, top: number, width: number, height: number, fill?: RGB) {
    this.page.drawRectangle({
      x, y: top - height, width, height,
      borderColor: LINE, borderWidth: 0.6, ...(fill ? { color: fill } : {})
    });
  }

  rule(x: number, top: number, width: number) {
    this.page.drawLine({ start: { x, y: top }, end: { x: x + width, y: top }, thickness: 0.6, color: LINE });
  }
}

type Pair = [label: string, value: string];

/** Label left, value right — the invoice meta and the totals both read this way. */
function pairs(sheet: Sheet, rows: Pair[], x: number, top: number, width: number): number {
  const size = 8.5;
  const labelWidth = width * 0.44;
  const valueWidth = width - labelWidth - 6;
  let y = top;
  for (const [label, value] of rows) {
    const labels = sheet.wrap(label, size, labelWidth, false);
    const values = sheet.wrap(value, size, valueWidth, true);
    sheet.text(labels, { x, top: y, size, color: MUTED });
    sheet.text(values, { x: x + labelWidth + 6, top: y, size, bold: true, width: valueWidth, align: "right" });
    y -= sheet.measure(Math.max(labels.length, values.length), size);
  }
  return top - y;
}

type Party = { name?: string; clinicName?: string; address?: string; city?: string; pinCode?: string; state?: string; phone?: string; gstin?: string };

function partyRuns(title: string, party: Party, extras: Run[] = []): Run[] {
  const place = [[party.city, party.pinCode].filter(Boolean).join(" - "), party.state].filter(Boolean).join(", ");
  return [
    { text: title.toUpperCase(), size: 7, bold: true, color: MUTED },
    { text: party.name || "—", size: 10, bold: true, gap: 2 },
    ...(party.clinicName ? [{ text: party.clinicName, size: 8.5 }] : []),
    ...(party.address ? [{ text: party.address, size: 8, color: MUTED }] : []),
    ...(place ? [{ text: place, size: 8, color: MUTED }] : []),
    ...(party.phone ? [{ text: `Phone: ${party.phone}`, size: 8, color: MUTED }] : []),
    ...(party.gstin ? [{ text: `GSTIN: ${party.gstin}`, size: 8, bold: true, gap: 2 }] : []),
    ...extras
  ];
}

type Column = { header: string; width: number; align?: "left" | "right" | "center" };
type Cell = { text: string; sub?: string; bold?: boolean };

/**
 * The line table, which is the one part of the bill that can outgrow a page.
 * Rows break across pages and the header is drawn again at the top of each, so
 * a second page of lines is still readable on its own.
 */
function table(sheet: Sheet, columns: Column[], rows: Cell[][]) {
  const size = 8;
  const sub = 6.5;
  const padX = 3;
  const padY = 3.5;

  const header = () => {
    const height = sheet.measure(1, size) + padY * 2;
    sheet.room(height + 20);
    let x = MARGIN;
    for (const column of columns) {
      sheet.box(x, sheet.y, column.width, height, SHADE);
      sheet.text([column.header], {
        x: x + padX, top: sheet.y - padY, size, bold: true,
        width: column.width - padX * 2, align: column.align
      });
      x += column.width;
    }
    sheet.y -= height;
  };

  header();
  for (const row of rows) {
    const wrapped = row.map((cell, index) =>
      sheet.wrap(cell.text, size, columns[index].width - padX * 2, cell.bold));
    const height = Math.max(...wrapped.map((lines, index) =>
      sheet.measure(lines.length, size) + (row[index].sub ? sheet.measure(1, sub) : 0))) + padY * 2;

    if (sheet.y - height < MARGIN + FOOT) { sheet.turn(); header(); }

    let x = MARGIN;
    row.forEach((cell, index) => {
      const column = columns[index];
      sheet.box(x, sheet.y, column.width, height);
      const used = sheet.text(wrapped[index], {
        x: x + padX, top: sheet.y - padY, size, bold: cell.bold,
        width: column.width - padX * 2, align: column.align
      });
      if (cell.sub) {
        sheet.text([cell.sub], {
          x: x + padX, top: sheet.y - padY - used, size: sub, color: MUTED,
          width: column.width - padX * 2, align: column.align
        });
      }
      x += column.width;
    });
    sheet.y -= height;
  }
}

export type PaymentQr = { bytes: Uint8Array; type?: string; label?: string };

/**
 * `invoiceNo` carries slashes — BHX/2026-27/0005 — which no filesystem wants.
 */
export function pdfFileName(invoiceNo: string): string {
  const cleaned = safe(invoiceNo).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${cleaned || "invoice"}.pdf`;
}

export async function renderInvoicePdf(
  invoice: InvoiceRecord, settings: SellerSettings, qr?: PaymentQr | null
): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${invoice.taxed ? "Tax invoice" : "Bill of supply"} ${safe(invoice.invoiceNo)}`);
  doc.setAuthor(safe(settings.tradeName || settings.legalName || "BHEALIX"));
  doc.setProducer("BHEALIX");
  doc.setCreator("BHEALIX");

  const sheet = new Sheet(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold)
  );

  const taxed = invoice.taxed;
  const split = taxed && !invoice.interState;
  const hasFreeGoods = invoice.items.some(item => (item.freeQuantity ?? 0) > 0);
  const freeUnits = invoice.items.reduce((total, item) => total + (item.freeQuantity ?? 0), 0);

  /* Heading. */
  sheet.y -= sheet.text([taxed ? "TAX INVOICE" : "BILL OF SUPPLY"],
    { x: MARGIN, top: sheet.y, size: 13, bold: true, width: WIDTH, align: "center" });
  if (!taxed) {
    sheet.y -= sheet.text(["Not eligible to charge GST on this supply"],
      { x: MARGIN, top: sheet.y, size: 7.5, color: MUTED, width: WIDTH, align: "center" });
  }
  if (invoice.status === "Cancelled") {
    const height = 15;
    const width = 74;
    sheet.y -= 3;
    sheet.page.drawRectangle({
      x: MARGIN + (WIDTH - width) / 2, y: sheet.y - height, width, height,
      borderColor: DANGER, borderWidth: 0.9
    });
    sheet.text(["CANCELLED"], { x: MARGIN, top: sheet.y - 2.5, size: 9, bold: true, color: DANGER, width: WIDTH, align: "center" });
    sheet.y -= height;
  }
  sheet.y -= 8;

  /* Who is selling, who is buying, and the meta that identifies the bill. */
  const leftWidth = WIDTH * 0.54;
  const rightWidth = WIDTH - leftWidth;
  const pad = 8;
  const seller: Party = {
    name: settings.tradeName || settings.legalName, address: settings.address, city: settings.city,
    pinCode: settings.pinCode, state: settings.state, phone: settings.phone, gstin: settings.gstin
  };
  const sellerRuns = partyRuns("Sold by", seller, [
    ...(settings.pan ? [{ text: `PAN: ${settings.pan}`, size: 8 } as Run] : []),
    ...(settings.drugLicenceNo ? [{ text: `Drug Licence: ${settings.drugLicenceNo}`, size: 8 } as Run] : []),
    ...(settings.email ? [{ text: settings.email, size: 8, color: MUTED } as Run] : [])
  ]);
  const metaRows: Pair[] = [
    ["Invoice no.", invoice.invoiceNo],
    ["Invoice date", formatDate(invoice.invoiceDate)],
    ...(invoice.dueDate ? [["Payment due", formatDate(invoice.dueDate)] as Pair] : []),
    ...(taxed ? [["Place of supply",
      `${invoice.placeOfSupply?.state || "—"}${invoice.placeOfSupply?.code ? ` (${invoice.placeOfSupply.code})` : ""}`] as Pair] : []),
    ...(invoice.employee ? [["Representative",
      `${invoice.employee.name}${invoice.employee.employeeId ? ` (${invoice.employee.employeeId})` : ""}`] as Pair] : [])
  ];

  const topHeight = Math.max(
    sheet.blockHeight(sellerRuns, leftWidth - pad * 2),
    sheet.measure(metaRows.length, 8.5)
  ) + pad * 2;

  const buyerRuns = partyRuns(
    invoice.billTo?.type && invoice.billTo.type !== "Doctor" ? `Billed to · ${invoice.billTo.type}` : "Billed to",
    invoice.billTo ?? {}
  );
  const supplyRuns: Run[] = [
    { text: "SUPPLY", size: 7, bold: true, color: MUTED },
    {
      text: taxed
        ? invoice.interState ? "Inter-state supply — IGST charged" : "Intra-state supply — CGST and SGST charged"
        : "No GST charged on this bill",
      size: 8.5, gap: 2
    },
    { text: `Rates are ${invoice.ratesIncludeTax ? "inclusive of" : "exclusive of"} tax.`, size: 8, color: MUTED }
  ];
  const buyerHeight = Math.max(
    sheet.blockHeight(buyerRuns, leftWidth - pad * 2),
    sheet.blockHeight(supplyRuns, rightWidth - pad * 2)
  ) + pad * 2;

  sheet.room(topHeight + buyerHeight + 60);
  const partiesTop = sheet.y;
  sheet.box(MARGIN, partiesTop, WIDTH, topHeight + buyerHeight);
  sheet.page.drawLine({
    start: { x: MARGIN + leftWidth, y: partiesTop }, end: { x: MARGIN + leftWidth, y: partiesTop - topHeight - buyerHeight },
    thickness: 0.6, color: LINE
  });
  sheet.rule(MARGIN, partiesTop - topHeight, WIDTH);

  sheet.block(sellerRuns, MARGIN + pad, partiesTop - pad, leftWidth - pad * 2);
  pairs(sheet, metaRows, MARGIN + leftWidth + pad, partiesTop - pad, rightWidth - pad * 2);
  sheet.block(buyerRuns, MARGIN + pad, partiesTop - topHeight - pad, leftWidth - pad * 2);
  sheet.block(supplyRuns, MARGIN + leftWidth + pad, partiesTop - topHeight - pad, rightWidth - pad * 2);
  sheet.y = partiesTop - topHeight - buyerHeight - 8;

  /* The lines. Columns appear only when the bill has something to put in them. */
  const columns: Column[] = [{ header: "#", width: 20, align: "center" }, { header: "Product", width: 0 }];
  if (taxed) columns.push({ header: "HSN", width: 42 });
  columns.push({ header: "Qty", width: 32, align: "right" });
  if (hasFreeGoods) columns.push({ header: "Free", width: 28, align: "right" });
  columns.push({ header: "Rate", width: 48, align: "right" });
  columns.push({ header: "Discount", width: 52, align: "right" });
  columns.push({ header: "Taxable", width: 54, align: "right" });
  if (split) columns.push({ header: "CGST", width: 48, align: "right" }, { header: "SGST", width: 48, align: "right" });
  else if (taxed) columns.push({ header: "IGST", width: 50, align: "right" });
  columns.push({ header: "Amount", width: 58, align: "right" });
  columns[1].width = WIDTH - columns.reduce((total, column) => total + column.width, 0);

  table(sheet, columns, invoice.items.map((item, index) => {
    const row: Cell[] = [
      { text: String(index + 1) },
      { text: item.unit ? `${item.name} · ${item.unit}` : item.name, bold: true }
    ];
    if (taxed) row.push({ text: item.hsnCode || "—" });
    row.push({ text: String(item.quantity) });
    if (hasFreeGoods) row.push({ text: item.freeQuantity ? `+${item.freeQuantity}` : "—", bold: Boolean(item.freeQuantity) });
    row.push({ text: item.rate.toFixed(2) });
    row.push({
      text: item.discount > 0 ? item.discount.toFixed(2) : "—",
      sub: item.discount > 0 && item.discountType === "PERCENT" ? `(${item.discountValue}%)` : undefined
    });
    row.push({ text: item.taxableValue.toFixed(2) });
    if (split) row.push(
      { text: item.cgst.toFixed(2), sub: `${item.gstRate / 2}%` },
      { text: item.sgst.toFixed(2), sub: `${item.gstRate / 2}%` }
    );
    else if (taxed) row.push({ text: item.igst.toFixed(2), sub: `${item.gstRate}%` });
    row.push({ text: item.total.toFixed(2), bold: true });
    return row;
  }));
  sheet.y -= 8;

  /*
    The closing half of the sheet: what is owed on the right, and everything
    said about the supply on the left. Both are measured before either is drawn
    so the pair moves to a fresh page together rather than being sawn in half.
  */
  const totalsWidth = 200;
  const asideWidth = WIDTH - totalsWidth - 8;

  const totalRows: Array<{ label: string; value: string; strong?: boolean; shade?: boolean }> = [
    { label: "Subtotal", value: money(invoice.subtotal) },
    ...(invoice.totalDiscount > 0 ? [{ label: "Discount", value: `- ${money(invoice.totalDiscount)}` }] : []),
    { label: "Taxable value", value: money(invoice.taxableValue) },
    ...(split ? [
      { label: "CGST", value: money(invoice.cgstTotal) },
      { label: "SGST", value: money(invoice.sgstTotal) }
    ] : []),
    ...(taxed && invoice.interState ? [{ label: "IGST", value: money(invoice.igstTotal) }] : []),
    ...(invoice.roundOff !== 0 ? [{ label: "Round off", value: money(invoice.roundOff) }] : []),
    { label: "Total payable", value: money(invoice.grandTotal), strong: true, shade: true },
    ...(invoice.amountPaid > 0 ? [
      { label: "Paid", value: money(invoice.amountPaid) },
      { label: "Balance due", value: money(invoice.balanceDue), strong: true }
    ] : [])
  ];
  const totalsHeight = totalRows.length * 15;

  const words: Run[] = [
    { text: "AMOUNT IN WORDS", size: 7, bold: true, color: MUTED },
    { text: amountInWords(invoice.grandTotal), size: 8.5, bold: true, gap: 1 }
  ];
  const scheme: Run[] = hasFreeGoods ? [
    { text: "FREE GOODS", size: 7, bold: true, color: MUTED },
    {
      text: `${freeUnits} unit${freeUnits === 1 ? "" : "s"} supplied free of charge under scheme — ${
        invoice.items.filter(item => item.freeQuantity)
          .map(item => `${item.name} ${item.quantity}+${item.freeQuantity}`).join(", ")}.`,
      size: 8, gap: 1
    }
  ] : [];
  const bank: Run[] = (settings.bankName || settings.upiId || qr) ? [
    { text: "PAYMENT DETAILS", size: 7, bold: true, color: MUTED },
    ...[
      settings.bankAccountName && `Account name: ${settings.bankAccountName}`,
      settings.bankName && `Bank: ${settings.bankName}`,
      settings.bankAccountNo && `A/c no: ${settings.bankAccountNo}`,
      settings.bankIfsc && `IFSC: ${settings.bankIfsc}`,
      settings.bankBranch && `Branch: ${settings.bankBranch}`,
      settings.upiId && `UPI: ${settings.upiId}`
    ].filter(Boolean).map((text, index) => ({ text: text as string, size: 8, gap: index === 0 ? 1 : 0 }))
  ] : [];

  /*
    Only PNG and JPEG go in: a WebP code would have to be decoded first, and
    the bank details printed beside it already say how to pay. The image is
    square, so the box is the side of the square.
  */
  const qrImage = qr && qr.bytes.byteLength
    ? await embedQr(doc, qr)
    : null;
  const qrSide = 66;
  const bankTextWidth = qrImage ? asideWidth - 16 - qrSide - 8 : asideWidth - 16;

  const taxRows = taxed && invoice.taxSummary.length > 0 ? invoice.taxSummary : [];
  // HSN takes what the money columns beside it leave, or the grid runs out from
  // under the totals on the other half of the page.
  const taxColumns: Column[] = [
    { header: "HSN", width: asideWidth - 60 * (invoice.interState ? 2 : 3) },
    { header: "Taxable", width: 60, align: "right" },
    ...(invoice.interState
      ? [{ header: "IGST", width: 60, align: "right" } as Column]
      : [{ header: "CGST", width: 60, align: "right" } as Column, { header: "SGST", width: 60, align: "right" } as Column])
  ];
  const taxHeight = taxRows.length ? (taxRows.length + 1) * 14 + 6 : 0;

  const wordsHeight = sheet.blockHeight(words, asideWidth - 16) + 10;
  const schemeHeight = scheme.length ? sheet.blockHeight(scheme, asideWidth - 16) + 10 : 0;
  const bankHeight = bank.length
    ? Math.max(sheet.blockHeight(bank, bankTextWidth), qrImage ? qrSide + 9 : 0) + 10
    : 0;
  const asideHeight = taxHeight + wordsHeight + (schemeHeight ? schemeHeight + 5 : 0) + (bankHeight ? bankHeight + 5 : 0);

  sheet.room(Math.max(asideHeight, totalsHeight));
  const closingTop = sheet.y;

  /* Left: tax summary, the amount said in words, the scheme, how to pay. */
  let asideY = closingTop;
  if (taxRows.length) {
    const saved = sheet.y;
    sheet.y = asideY;
    // Drawn through the same table so the two grids on the sheet match.
    tableAt(sheet, taxColumns, taxRows.map(row => [
      { text: `${row.hsnCode || "—"} @ ${row.gstRate}%` },
      { text: row.taxableValue.toFixed(2) },
      ...(invoice.interState ? [{ text: row.igst.toFixed(2) }] : [{ text: row.cgst.toFixed(2) }, { text: row.sgst.toFixed(2) }])
    ]), MARGIN);
    asideY = sheet.y - 5;
    sheet.y = saved;
  }

  sheet.box(MARGIN, asideY, asideWidth, wordsHeight);
  sheet.block(words, MARGIN + 8, asideY - 5, asideWidth - 16);
  asideY -= wordsHeight;

  if (schemeHeight) {
    asideY -= 5;
    sheet.box(MARGIN, asideY, asideWidth, schemeHeight);
    sheet.block(scheme, MARGIN + 8, asideY - 5, asideWidth - 16);
    asideY -= schemeHeight;
  }

  if (bankHeight) {
    asideY -= 5;
    sheet.box(MARGIN, asideY, asideWidth, bankHeight);
    sheet.block(bank, MARGIN + 8, asideY - 5, bankTextWidth);
    if (qrImage) {
      sheet.page.drawImage(qrImage, {
        x: MARGIN + asideWidth - 8 - qrSide, y: asideY - 5 - qrSide, width: qrSide, height: qrSide
      });
      sheet.text([safe(qr?.label) || "Scan to pay"], {
        x: MARGIN + asideWidth - 8 - qrSide, top: asideY - 5 - qrSide, size: 6.5, color: MUTED,
        width: qrSide, align: "center"
      });
    }
    asideY -= bankHeight;
  }

  /* Right: what is owed. */
  let totalsY = closingTop;
  for (const row of totalRows) {
    sheet.box(MARGIN + asideWidth + 8, totalsY, totalsWidth, 15, row.shade ? SHADE : undefined);
    sheet.text([row.label], { x: MARGIN + asideWidth + 14, top: totalsY - 2.5, size: 8.5, bold: row.strong });
    sheet.text([row.value], {
      x: MARGIN + asideWidth + 14, top: totalsY - 2.5, size: row.shade ? 9.5 : 8.5, bold: row.strong,
      width: totalsWidth - 20, align: "right"
    });
    totalsY -= 15;
  }

  sheet.y = Math.min(asideY, totalsY) - 8;

  /* Receipts already taken against the bill. */
  if (invoice.payments.length > 0) {
    const rows = invoice.payments.map(payment => ({
      left: `${formatDate(payment.paidAt)} · ${payment.mode}${payment.reference ? ` · ${payment.reference}` : ""}${
        payment.receivedBy?.name ? ` · received by ${payment.receivedBy.name}` : ""}`,
      right: money(payment.amount)
    }));
    const height = 14 + rows.length * 12 + 10;
    sheet.room(height);
    sheet.box(MARGIN, sheet.y, WIDTH, height);
    let y = sheet.y - 6;
    y -= sheet.text(["PAYMENTS RECEIVED"], { x: MARGIN + 8, top: y, size: 7, bold: true, color: MUTED });
    for (const row of rows) {
      // One line each: the amount on the right must stay clear of the detail.
      sheet.text(sheet.wrap(row.left, 8, WIDTH - 16 - 80).slice(0, 1), { x: MARGIN + 8, top: y, size: 8 });
      sheet.text([row.right], { x: MARGIN + 8, top: y, size: 8, bold: true, width: WIDTH - 16, align: "right" });
      y -= 12;
    }
    sheet.y -= height + 8;
  }

  /* Notes and terms beside the two signatures. */
  const notes: Run[] = [
    ...(invoice.notes ? [{ text: `Note: ${invoice.notes}`, size: 8 } as Run] : []),
    ...(invoice.terms ? [
      { text: "TERMS", size: 7, bold: true, color: MUTED, gap: invoice.notes ? 4 : 0 } as Run,
      { text: invoice.terms, size: 7.5, color: MUTED, gap: 1 } as Run
    ] : [])
  ];
  const signWidth = 128;
  const receiver = settings.showReceiverSignature !== false;
  const notesWidth = WIDTH - signWidth * (receiver ? 2 : 1) - 16;
  const signHeight = 58;
  const closing = Math.max(notes.length ? sheet.blockHeight(notes, notesWidth) : 0, signHeight);
  sheet.room(closing + 26);

  const closeTop = sheet.y;
  if (notes.length) sheet.block(notes, MARGIN, closeTop, notesWidth);

  const signTop = closeTop - Math.max(0, closing - signHeight);
  let signX = MARGIN + WIDTH - signWidth;
  const signature = (title: string, caption: string) => {
    sheet.text([title], { x: signX, top: signTop, size: 8, bold: true, width: signWidth, align: "center" });
    sheet.rule(signX + 8, signTop - signHeight + 12, signWidth - 16);
    sheet.text([caption], { x: signX, top: signTop - signHeight + 12, size: 7.5, color: MUTED, width: signWidth, align: "center" });
    signX -= signWidth + 8;
  };
  signature(`For ${settings.tradeName || settings.legalName}`, settings.signatoryName || "Authorised signatory");
  if (receiver) signature(settings.receiverSignatureLabel || "Received by", "Signature, name and date");

  sheet.y = closeTop - closing - 10;
  sheet.room(16);
  sheet.paragraph(
    receiver
      ? `This ${taxed ? "invoice" : "bill"} is computer-generated and needs no signature from ${
        settings.tradeName || settings.legalName}. The receiver signs above to acknowledge the goods.`
      : `This is a computer-generated ${taxed ? "invoice" : "bill"} and is valid without a physical signature.`,
    { x: MARGIN, top: sheet.y, size: 7, color: MUTED, width: WIDTH, align: "center" }
  );

  /* "Page 1 of 3", once the count is known. */
  const pages = doc.getPages();
  if (pages.length > 1) {
    pages.forEach((page, index) => {
      const label = `${safe(invoice.invoiceNo)} · Page ${index + 1} of ${pages.length}`;
      const width = sheet.regular.widthOfTextAtSize(label, 7);
      page.drawText(label, { x: (PAGE.width - width) / 2, y: MARGIN - 12, size: 7, font: sheet.regular, color: MUTED });
    });
  }

  return (await doc.save()) as Uint8Array<ArrayBuffer>;
}

/** The tax summary grid, drawn at `x` rather than across the whole page. */
function tableAt(sheet: Sheet, columns: Column[], rows: Cell[][], x: number) {
  const size = 7.5;
  const height = 14;
  let cursor = x;
  for (const column of columns) {
    sheet.box(cursor, sheet.y, column.width, height, SHADE);
    sheet.text([column.header], { x: cursor + 3, top: sheet.y - 3, size, bold: true, width: column.width - 6, align: column.align });
    cursor += column.width;
  }
  sheet.y -= height;

  for (const row of rows) {
    if (sheet.y - height < MARGIN + FOOT) sheet.turn();
    cursor = x;
    row.forEach((cell, index) => {
      const column = columns[index];
      sheet.box(cursor, sheet.y, column.width, height);
      sheet.text(sheet.wrap(cell.text, size, column.width - 6).slice(0, 1),
        { x: cursor + 3, top: sheet.y - 3, size, width: column.width - 6, align: column.align });
      cursor += column.width;
    });
    sheet.y -= height;
  }
}

async function embedQr(doc: PDFDocument, qr: PaymentQr) {
  try {
    if (qr.type === "image/png") return await doc.embedPng(qr.bytes);
    if (qr.type === "image/jpeg") return await doc.embedJpg(qr.bytes);
  } catch {
    // A code that will not decode is left off rather than failing the download.
  }
  return null;
}
