import { amountInWords } from "@/lib/billing/gst";
import { formatMoney } from "@/lib/billing/constants";
import { formatDate } from "@/lib/time";
import type { SellerSettings } from "@/lib/billing/invoices";
import type { InvoiceRecord } from "@/lib/billing/types";

/**
 * The bill itself, laid out as it prints.
 *
 * Plain elements and a fixed palette rather than the app's theme tokens: this
 * sheet is meant to survive a black-and-white laser printer and a PDF saved on
 * a phone, where a cream background and a walnut brand colour are noise. Sizes
 * are in millimetres so an A4 page comes out at A4.
 */

const line = "border border-neutral-400";
const cell = "border border-neutral-400 px-2 py-1.5 align-top";

function Address({ title, party, extra }: { title: string; party: Record<string, string | undefined>; extra?: React.ReactNode }) {
  return <div className="min-w-0 flex-1 p-3">
    <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
      {title}{party.type && party.type !== "Doctor" ? ` · ${party.type}` : ""}
    </p>
    <p className="mt-1 text-[13px] font-bold leading-snug">{party.name}</p>
    {party.clinicName && <p className="text-[12px] leading-snug">{party.clinicName}</p>}
    {party.address && <p className="mt-0.5 whitespace-pre-line text-[11px] leading-snug text-neutral-700">{party.address}</p>}
    <p className="text-[11px] leading-snug text-neutral-700">
      {[party.city, party.pinCode].filter(Boolean).join(" - ")}
      {party.state ? `${party.city || party.pinCode ? ", " : ""}${party.state}` : ""}
    </p>
    {party.phone && <p className="text-[11px] leading-snug text-neutral-700">Phone: {party.phone}</p>}
    {party.gstin && <p className="mt-1 text-[11px] font-semibold">GSTIN: {party.gstin}</p>}
    {extra}
  </div>;
}

export function InvoiceDocument({ invoice, settings }: { invoice: InvoiceRecord; settings: SellerSettings }) {
  const taxed = invoice.taxed;
  const seller = {
    name: settings.tradeName || settings.legalName,
    address: settings.address,
    city: settings.city,
    pinCode: settings.pinCode,
    state: settings.state,
    phone: settings.phone,
    gstin: settings.gstin
  };

  /*
   * A 10mm margin is right on paper and wrong on a 360px phone, where it eats a
   * fifth of the screen before the sheet has drawn anything. The screen gets a
   * smaller inset and paper gets its margin back at the width an A4 page needs.
   */
  return <article className="invoice-sheet mx-auto w-full max-w-[210mm] bg-white p-4 text-neutral-900 shadow-sm sm:p-[10mm] print:max-w-none print:p-0 print:shadow-none">
    {/* Title first: whoever picks the page up must see what the document is. */}
    <header className="text-center">
      <h1 className="text-[15px] font-bold uppercase tracking-[0.2em]">
        {taxed ? "Tax Invoice" : "Bill of Supply"}
      </h1>
      {!taxed && <p className="mt-0.5 text-[10px] text-neutral-600">Not eligible to charge GST on this supply</p>}
      {invoice.status === "Cancelled" && (
        <p className="mt-1 inline-block border border-red-600 px-3 py-0.5 text-[11px] font-bold uppercase tracking-widest text-red-600">
          Cancelled
        </p>
      )}
    </header>

    <div className={`mt-2 ${line}`}>
      <div className="flex flex-wrap border-b border-neutral-400">
        <Address title="Sold by" party={seller} extra={<>
          {settings.pan && <p className="text-[11px]">PAN: {settings.pan}</p>}
          {settings.drugLicenceNo && <p className="text-[11px]">Drug Licence: {settings.drugLicenceNo}</p>}
          {settings.email && <p className="text-[11px] text-neutral-700">{settings.email}</p>}
        </>} />

        <div className="w-full shrink-0 border-t border-neutral-400 p-3 sm:w-[46%] sm:border-l sm:border-t-0">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-neutral-600">Invoice no.</dt>
            <dd className="text-right font-bold">{invoice.invoiceNo}</dd>
            <dt className="text-neutral-600">Invoice date</dt>
            <dd className="text-right font-semibold">{formatDate(invoice.invoiceDate)}</dd>
            {invoice.dueDate && <>
              <dt className="text-neutral-600">Payment due</dt>
              <dd className="text-right font-semibold">{formatDate(invoice.dueDate)}</dd>
            </>}
            {taxed && <>
              <dt className="text-neutral-600">Place of supply</dt>
              <dd className="text-right font-semibold">
                {invoice.placeOfSupply?.state || "—"}{invoice.placeOfSupply?.code ? ` (${invoice.placeOfSupply.code})` : ""}
              </dd>
            </>}
            {invoice.employee && <>
              {/* The bill is worked by a person, and the doctor should know which. */}
              <dt className="text-neutral-600">Representative</dt>
              <dd className="text-right font-semibold">
                {invoice.employee.name}{invoice.employee.employeeId ? ` (${invoice.employee.employeeId})` : ""}
              </dd>
            </>}
          </dl>
        </div>
      </div>

      <div className="flex flex-wrap">
        <Address title="Billed to" party={invoice.billTo as Record<string, string | undefined>} />
        <div className="w-full shrink-0 border-t border-neutral-400 p-3 text-[11px] sm:w-[46%] sm:border-l sm:border-t-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Supply</p>
          <p className="mt-1">
            {taxed
              ? invoice.interState
                ? "Inter-state supply — IGST charged"
                : "Intra-state supply — CGST and SGST charged"
              : "No GST charged on this bill"}
          </p>
          <p className="mt-1 text-neutral-600">
            Rates are {invoice.ratesIncludeTax ? "inclusive of" : "exclusive of"} tax.
          </p>
        </div>
      </div>
    </div>

    {/* The line table has ten columns on a tax invoice. It scrolls sideways on a
        phone rather than dragging the whole sheet with it; print ignores the
        overflow because the page is wide enough to hold it. */}
    <div className="mt-2 overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[560px] border-collapse text-[11px] print:min-w-0">
        <thead>
          <tr className="bg-neutral-100 text-left">
            <th className={`${cell} w-8 text-center`}>#</th>
            <th className={cell}>Product</th>
            {taxed && <th className={`${cell} w-16`}>HSN</th>}
            <th className={`${cell} w-16 text-right`}>Qty</th>
            <th className={`${cell} w-20 text-right`}>Rate</th>
            <th className={`${cell} w-24 text-right`}>Discount</th>
            <th className={`${cell} w-24 text-right`}>Taxable</th>
            {taxed && !invoice.interState && <>
              <th className={`${cell} w-24 text-right`}>CGST</th>
              <th className={`${cell} w-24 text-right`}>SGST</th>
            </>}
            {taxed && invoice.interState && <th className={`${cell} w-24 text-right`}>IGST</th>}
            <th className={`${cell} w-24 text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={`${item.name}-${index}`}>
              <td className={`${cell} text-center`}>{index + 1}</td>
              <td className={cell}>
                <span className="font-semibold">{item.name}</span>
                {item.unit && <span className="text-neutral-500"> · {item.unit}</span>}
              </td>
              {taxed && <td className={cell}>{item.hsnCode || "—"}</td>}
              <td className={`${cell} text-right`}>{item.quantity}</td>
              <td className={`${cell} text-right`}>{item.rate.toFixed(2)}</td>
              <td className={`${cell} text-right`}>
                {item.discount > 0 ? <>
                  {item.discount.toFixed(2)}
                  {item.discountType === "PERCENT" && (
                    <span className="block text-[10px] text-neutral-500">({item.discountValue}%)</span>
                  )}
                </> : "—"}
              </td>
              <td className={`${cell} text-right`}>{item.taxableValue.toFixed(2)}</td>
              {taxed && !invoice.interState && <>
                <td className={`${cell} text-right`}>
                  {item.cgst.toFixed(2)}<span className="block text-[10px] text-neutral-500">{item.gstRate / 2}%</span>
                </td>
                <td className={`${cell} text-right`}>
                  {item.sgst.toFixed(2)}<span className="block text-[10px] text-neutral-500">{item.gstRate / 2}%</span>
                </td>
              </>}
              {taxed && invoice.interState && (
                <td className={`${cell} text-right`}>
                  {item.igst.toFixed(2)}<span className="block text-[10px] text-neutral-500">{item.gstRate}%</span>
                </td>
              )}
              <td className={`${cell} text-right font-semibold`}>{item.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="mt-2 flex flex-wrap items-start gap-2">
      <div className="min-w-[45%] flex-1 space-y-2">
        {taxed && invoice.taxSummary.length > 0 && (
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-neutral-100">
                <th className={`${cell} text-left`}>HSN</th>
                <th className={`${cell} text-right`}>Taxable</th>
                {invoice.interState
                  ? <th className={`${cell} text-right`}>IGST</th>
                  : <><th className={`${cell} text-right`}>CGST</th><th className={`${cell} text-right`}>SGST</th></>}
              </tr>
            </thead>
            <tbody>
              {invoice.taxSummary.map((row, index) => (
                <tr key={index}>
                  <td className={cell}>{row.hsnCode || "—"} <span className="text-neutral-500">@ {row.gstRate}%</span></td>
                  <td className={`${cell} text-right`}>{row.taxableValue.toFixed(2)}</td>
                  {invoice.interState
                    ? <td className={`${cell} text-right`}>{row.igst.toFixed(2)}</td>
                    : <><td className={`${cell} text-right`}>{row.cgst.toFixed(2)}</td>
                        <td className={`${cell} text-right`}>{row.sgst.toFixed(2)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className={`${line} p-2`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Amount in words</p>
          <p className="text-[11px] font-semibold">{amountInWords(invoice.grandTotal)}</p>
        </div>

        {(settings.bankName || settings.upiId) && (
          <div className={`${line} p-2 text-[10px] leading-relaxed`}>
            <p className="font-bold uppercase tracking-wider text-neutral-500">Payment details</p>
            {settings.bankAccountName && <p>Account name: {settings.bankAccountName}</p>}
            {settings.bankName && <p>Bank: {settings.bankName}</p>}
            {settings.bankAccountNo && <p>A/c no: {settings.bankAccountNo}</p>}
            {settings.bankIfsc && <p>IFSC: {settings.bankIfsc}</p>}
            {settings.upiId && <p>UPI: {settings.upiId}</p>}
          </div>
        )}
      </div>

      <div className="w-full sm:w-[42%]">
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            <Total label="Subtotal" value={invoice.subtotal} />
            {invoice.totalDiscount > 0 && <Total label="Discount" value={-invoice.totalDiscount} />}
            <Total label="Taxable value" value={invoice.taxableValue} />
            {taxed && !invoice.interState && <>
              <Total label="CGST" value={invoice.cgstTotal} />
              <Total label="SGST" value={invoice.sgstTotal} />
            </>}
            {taxed && invoice.interState && <Total label="IGST" value={invoice.igstTotal} />}
            {invoice.roundOff !== 0 && <Total label="Round off" value={invoice.roundOff} />}
            <tr className="bg-neutral-100">
              <td className={`${cell} font-bold`}>Total payable</td>
              <td className={`${cell} text-right text-[13px] font-bold`}>{formatMoney(invoice.grandTotal)}</td>
            </tr>
            {invoice.amountPaid > 0 && <>
              <Total label="Paid" value={invoice.amountPaid} />
              <tr>
                <td className={`${cell} font-bold`}>Balance due</td>
                <td className={`${cell} text-right font-bold`}>{formatMoney(invoice.balanceDue)}</td>
              </tr>
            </>}
          </tbody>
        </table>
      </div>
    </div>

    {invoice.payments.length > 0 && (
      <div className={`mt-2 ${line} p-2`}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Payments received</p>
        <ul className="mt-1 space-y-0.5 text-[11px]">
          {invoice.payments.map(payment => (
            <li key={payment._id} className="flex justify-between gap-3">
              <span>
                {formatDate(payment.paidAt)} · {payment.mode}
                {payment.reference ? ` · ${payment.reference}` : ""}
                {payment.receivedBy?.name ? ` · received by ${payment.receivedBy.name}` : ""}
              </span>
              <span className="font-semibold">{formatMoney(payment.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    )}

    <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-[45%] flex-1 text-[10px] leading-relaxed text-neutral-700">
        {invoice.notes && <p className="mb-1"><span className="font-semibold">Note: </span>{invoice.notes}</p>}
        {invoice.terms && <><p className="font-bold uppercase tracking-wider text-neutral-500">Terms</p>
          <p className="whitespace-pre-line">{invoice.terms}</p></>}
      </div>
      <div className="w-[45mm] text-center text-[10px]">
        <p className="font-semibold">For {settings.tradeName || settings.legalName}</p>
        <div className="mt-10 border-t border-neutral-400 pt-1">{settings.signatoryName || "Authorised signatory"}</div>
      </div>
    </div>

    <p className="mt-3 text-center text-[9px] text-neutral-500">
      This is a computer-generated {taxed ? "invoice" : "bill"} and is valid without a physical signature.
    </p>
  </article>;
}

function Total({ label, value }: { label: string; value: number }) {
  return <tr>
    <td className={cell}>{label}</td>
    <td className={`${cell} text-right`}>{value < 0 ? `- ${formatMoney(Math.abs(value))}` : formatMoney(value)}</td>
  </tr>;
}
