"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, RefreshCw, Truck, X } from "lucide-react";
import { Badge, Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { COURIER_RULES, PROCESS_BATCH, type CourierRule } from "@/lib/sales/constants";
import {
  addressOf, blockedReason, missingFields, orderCount, paymentModeOf, stripBlank,
  type Address, type CourierOption
} from "@/lib/sales/fulfilment";
import { formatRupees, type FulfilmentOptions, type ProcessResult, type SalesOrderRecord } from "@/lib/sales/types";

/**
 * Booking parcels with the courier, which is the job this screen exists to take
 * off somebody's second browser tab.
 *
 * One dialog for one order and for forty. They ask the same four questions —
 * which warehouse, what size parcel, which courier, collect it or not — and the
 * only thing a single order adds is an address form, because an address belongs
 * to one order and a batch of forty has forty of them.
 *
 * Two things it refuses to do quietly:
 *
 * - **It counts what cannot be booked before it starts.** An order with no
 *   street address is going to be refused by Shiprocket, and finding that out
 *   thirty-eight orders into a batch is no use to anybody. They are named up
 *   front, in the dialog, while there is still a chance to fix one.
 * - **It reports every order, not a total.** "34 booked" with no list is a batch
 *   somebody has to go through by hand to find the other six.
 */

const RULE_LABEL: Record<CourierRule, string> = {
  recommended: "Shiprocket's pick — weighs price against the courier's record",
  cheapest: "Cheapest freight, per order",
  fastest: "Quickest promised delivery, per order"
};

type Progress = { done: number; total: number };

export function ProcessDialog({ orders, options, onClose, onDone }: {
  orders: SalesOrderRecord[];
  options: FulfilmentOptions;
  onClose: () => void;
  /** Called once the run has finished, so the list behind can be re-read. */
  onDone: () => void;
}) {
  const single = orders.length === 1 ? orders[0] : null;

  const [pickup, setPickup] = useState(options.defaults.pickupLocation ?? options.pickupLocations[0]?.name ?? "");
  const [parcel, setParcel] = useState({
    weight: String(options.defaults.parcel.weight),
    length: String(options.defaults.parcel.length),
    breadth: String(options.defaults.parcel.breadth),
    height: String(options.defaults.parcel.height)
  });
  /*
   * Choosing the courier by name is the default, and the rules are the
   * alternative rather than the other way round.
   *
   * Freight is money, and the difference between the cheapest and the quickest
   * on the same parcel is routinely half the margin on the order. Somebody
   * spending it should see the prices and decide, so the list is fetched as the
   * dialog opens rather than waiting behind a button. The rules stay for the
   * mornings when forty parcels matter more than four rupees each.
   */
  const [rule, setRule] = useState<CourierRule | "named">("named");
  const [courier, setCourier] = useState<{ id: number; name: string } | null>(
    options.defaults.courierId && options.defaults.courierName
      ? { id: options.defaults.courierId, name: options.defaults.courierName }
      : null
  );
  const [couriers, setCouriers] = useState<CourierOption[] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [pickupWanted, setPickupWanted] = useState(false);
  const [address, setAddress] = useState<Address>(single ? addressOf(single) : {});
  const [addressNote, setAddressNote] = useState("");
  const [fetchingAddress, setFetchingAddress] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [results, setResults] = useState<ProcessResult[] | null>(null);
  const [error, setError] = useState("");

  /*
   * Which of the selection cannot go, and why. Recomputed as the address is
   * typed, so fixing the street on a single order clears its own warning.
   */
  const problems = orders.map(order => {
    const blocked = blockedReason(order);
    if (blocked) return { order, reason: blocked };
    const missing = missingFields(addressOf(order, single ? address : null));
    return missing.length ? { order, reason: `missing the ${missing.join(", ")}` } : null;
  }).filter((problem): problem is { order: SalesOrderRecord; reason: string } => problem !== null);

  const ready = orders.length - problems.length;
  /** The order a quote is measured against: the one on screen, or the first that can go. */
  const quoteFor = single ?? orders.find(order => !problems.some(problem => problem.order._id === order._id));

  /**
   * Every address on this screen is fetched from the shop when this system has
   * not got one.
   *
   * Orders placed before parcels were booked from here kept only the city, the
   * state and the pin code — those were the three fields the commission
   * arithmetic read. Shopify has had the street all along, so it is asked, once,
   * and the answer is written back.
   */
  const fillAddress = useCallback(async () => {
    if (!single) return;
    setFetchingAddress(true); setAddressNote("");
    try {
      const response = await fetch("/api/sales/fulfilment/address", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: single._id })
      });
      const json = await response.json() as { data?: { address: Address; fetched: boolean; warning?: string }; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not read the address back from the shop.");
      // Anything already typed into the form wins — this fills gaps, it does not
      // overwrite somebody's correction.
      if (json.data?.address) setAddress(current => ({ ...json.data!.address, ...stripBlank(current) }));
      if (json.data?.warning) setAddressNote(json.data.warning);
      else if (json.data?.fetched) setAddressNote("Filled in from the shop.");
    } catch (problem) {
      setAddressNote(problem instanceof Error ? problem.message : "Could not reach the shop.");
    } finally {
      setFetchingAddress(false);
    }
  }, [single]);

  // Asked for on opening, and only when something is actually missing — an
  // order with a complete address costs no call at all.
  useEffect(() => {
    if (single && missingFields(addressOf(single)).length) fillAddress();
  }, [single, fillAddress]);

  /*
   * The address as it stands, without the quote depending on it.
   *
   * A pin code is typed a character at a time; if the quote were rebuilt on each
   * keystroke it would be six calls to Shiprocket to reach one answer, five of
   * them for pin codes that do not exist. The rates are re-asked for when the
   * parcel or the warehouse changes, and by the Refresh rates button otherwise.
   */
  const typed = useRef(address);
  useEffect(() => { typed.current = address; }, [address]);

  /** Quoting is per pin code, so a batch is priced against its first order. */
  const quote = useCallback(async () => {
    if (!quoteFor) return;
    setQuoting(true); setQuoteError(""); setCouriers(null);
    try {
      const response = await fetch("/api/sales/fulfilment/couriers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: quoteFor._id,
          pickupLocation: pickup,
          weight: Number(parcel.weight) || options.defaults.parcel.weight,
          pinCode: single ? typed.current.pinCode : undefined
        })
      });
      const json = await response.json() as { data?: { couriers: CourierOption[] }; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not ask Shiprocket which couriers serve this address.");
      setCouriers(json.data?.couriers ?? []);
    } catch (problem) {
      setQuoteError(problem instanceof Error ? problem.message : "Could not reach Shiprocket.");
    } finally {
      setQuoting(false);
    }
  }, [quoteFor, single, pickup, parcel.weight, options.defaults.parcel.weight]);

  /*
   * Priced on opening, and re-priced whenever the parcel or the warehouse
   * changes — a rate quoted for half a kilo is not a rate for two, and leaving
   * the old figures on screen would have somebody choose on a price that is no
   * longer true.
   */
  useEffect(() => {
    setCourier(null);
    if (rule === "named") quote();
    else setCouriers(null);
  }, [rule, quote]);

  async function run() {
    setError(""); setResults(null);

    const sendable = orders.filter(order => !problems.some(problem => problem.order._id === order._id));
    if (!sendable.length) return setError("None of these orders can be booked yet.");
    if (rule === "named" && !courier) return setError("Choose a courier from the list, or pick a rule instead.");

    const collected: ProcessResult[] = [];
    setProgress({ done: 0, total: sendable.length });

    /*
     * Sent in chunks rather than in one request. Each order costs up to four
     * calls to Shiprocket, and one request carrying two hundred of them would
     * outlive the function running it — so the browser paces the work and shows
     * how far it has got.
     */
    for (let at = 0; at < sendable.length; at += PROCESS_BATCH) {
      const chunk = sendable.slice(at, at + PROCESS_BATCH);
      try {
        const response = await fetch("/api/sales/orders/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderIds: chunk.map(order => order._id),
            pickupLocation: pickup,
            parcel: {
              weight: Number(parcel.weight), length: Number(parcel.length),
              breadth: Number(parcel.breadth), height: Number(parcel.height)
            },
            ...(rule === "named" && courier ? { courierId: courier.id, courierName: courier.name } : { courierRule: rule }),
            schedulePickup: pickupWanted,
            ...(single ? { address } : {})
          })
        });
        const json = await response.json() as { data?: { results: ProcessResult[] }; error?: string };
        if (!response.ok) throw new Error(json.error ?? "Shiprocket refused the batch.");
        collected.push(...(json.data?.results ?? []));
      } catch (problem) {
        // A whole chunk failing is a credential or a network fault, not one bad
        // order — so every order in it is reported with the same reason rather
        // than vanishing from the tally.
        const message = problem instanceof Error ? problem.message : "Could not reach the server.";
        collected.push(...chunk.map(order => ({ orderId: order._id, name: order.name, ok: false, error: message })));
      }
      setProgress({ done: Math.min(at + PROCESS_BATCH, sendable.length), total: sendable.length });
    }

    setProgress(null);
    setResults(collected);
    onDone();
  }

  if (results) return <ResultsDialog results={results} onClose={onClose} />;

  const title = single ? `Process ${single.name}` : `Process ${orderCount(orders.length)}`;

  return <Modal title={title}
    description="Books the parcel with Shiprocket, chooses the courier and assigns the airway bill."
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose} disabled={Boolean(progress)}>Cancel</Button>
      <Button className="flex-1" busy={Boolean(progress)} disabled={!ready || !pickup} onClick={run}>
        <Truck size={16} />{progress ? `${progress.done} of ${progress.total}` : `Book ${orderCount(ready)}`}
      </Button>
    </div>}>

    <div className="space-y-4">
      {options.refusal && <Notice tone="error">{options.refusal}</Notice>}

      <Field label="Ships from" hint="The pickup address on your Shiprocket account.">
        <select className="select" value={pickup} onChange={event => setPickup(event.target.value)}>
          {options.pickupLocations.map(location => (
            <option key={location.name} value={location.name}>
              {location.name}{location.city ? ` — ${location.city}` : ""}{location.pinCode ? ` ${location.pinCode}` : ""}
            </option>
          ))}
          {!options.pickupLocations.length && <option value="">No pickup address on the account</option>}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Weight (kg)">
          <input className="input" type="number" step="0.1" min="0.1" value={parcel.weight}
            onChange={event => setParcel(current => ({ ...current, weight: event.target.value }))} />
        </Field>
        <Field label="Length (cm)">
          <input className="input" type="number" min="1" value={parcel.length}
            onChange={event => setParcel(current => ({ ...current, length: event.target.value }))} />
        </Field>
        <Field label="Breadth (cm)">
          <input className="input" type="number" min="1" value={parcel.breadth}
            onChange={event => setParcel(current => ({ ...current, breadth: event.target.value }))} />
        </Field>
        <Field label="Height (cm)">
          <input className="input" type="number" min="1" value={parcel.height}
            onChange={event => setParcel(current => ({ ...current, height: event.target.value }))} />
        </Field>
      </div>

      <Field label="Choose the courier"
        hint={rule === "named"
          ? "The named courier is never substituted — an order it cannot reach is reported instead."
          : "Decided per order, out of whatever can actually reach that pin code."}>
        <select className="select" value={rule} onChange={event => setRule(event.target.value as CourierRule | "named")}>
          <option value="named">Pick one from the list, by price</option>
          {COURIER_RULES.map(value => <option key={value} value={value}>{RULE_LABEL[value]}</option>)}
        </select>
      </Field>

      {rule === "named" && <>
        {/*
          * A batch is priced against its first order, because a rate is a rate
          * for one pin code. Said plainly rather than hidden, since the courier
          * chosen here still applies to all of them — and any it cannot reach
          * are reported rather than quietly sent by somebody else.
          */}
        {!single && quoteFor && (
          <p className="text-xs text-[var(--muted)]">
            Rates shown are for {quoteFor.name} to {quoteFor.customer?.city || "its pin code"}. The courier you choose is
            used for every order in this batch; the price on each depends on where it is going.
          </p>
        )}
        <CourierPicker couriers={couriers} chosen={courier} quoting={quoting} error={quoteError}
          onQuote={quote} onChoose={setCourier} />
      </>}

      {single && <AddressFields order={single} address={address} onChange={setAddress}
        note={addressNote} busy={fetchingAddress} onFetch={fillAddress} />}

      {problems.length > 0 && (
        <Notice tone="warning">
          <span className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              {problems.length} of {orders.length} cannot be booked and will be left alone:{" "}
              {problems.slice(0, 4).map(problem => `${problem.order.name} (${problem.reason})`).join("; ")}
              {problems.length > 4 ? ` and ${problems.length - 4} more.` : "."}
            </span>
          </span>
        </Notice>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={pickupWanted} onChange={event => setPickupWanted(event.target.checked)} />
        <span>
          Ask the courier to collect
          <span className="block text-xs text-[var(--muted)]">
            Leave this off if the warehouse already has a standing daily pickup — Shiprocket treats a second request for
            the same day as an error rather than ignoring it.
          </span>
        </span>
      </label>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

/**
 * The couriers that can carry this parcel, with what each costs.
 *
 * Asked for as the dialog opens, because this is the screen where freight is
 * spent and the spread between the cheapest and the quickest on one parcel is
 * routinely half the margin on the order. Sorted by price, with the delivery
 * promise beside it, so the trade being made is visible rather than inferred.
 *
 * Re-asked by the button rather than on a timer: the rates are for one weight
 * and one pin code, and both are fields on this same form.
 */
function CourierPicker({ couriers, chosen, quoting, error, onQuote, onChoose }: {
  couriers: CourierOption[] | null;
  chosen: { id: number; name: string } | null;
  quoting: boolean;
  error: string;
  onQuote: () => void;
  onChoose: (courier: { id: number; name: string }) => void;
}) {
  if (quoting && !couriers) {
    return <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
      <Loader2 size={14} className="animate-spin" />Asking Shiprocket which couriers serve this address…
    </p>;
  }

  if (!couriers) {
    return <div className="space-y-2">
      <Button tone="secondary" busy={quoting} onClick={onQuote}>Show couriers and rates</Button>
      {error && <Notice tone="error">{error}</Notice>}
    </div>;
  }

  if (!couriers.length) {
    return <div className="space-y-2">
      <Notice tone="error">{error || "No courier on this account serves that pin code at this weight."}</Notice>
      <Button tone="secondary" busy={quoting} onClick={onQuote}><RefreshCw size={14} />Try again</Button>
    </div>;
  }

  // Cheapest first. The list is read top-down by somebody deciding what to
  // spend, so the decision is between the first row and whatever above it is
  // worth paying more for.
  const byPrice = [...couriers].sort((left, right) => left.rate - right.rate);
  const cheapest = byPrice[0]?.rate ?? 0;

  return <div className="space-y-2">
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-[10px] border border-[var(--line)] p-1">
      {byPrice.map(courier => (
        <button key={courier.id} type="button" onClick={() => onChoose({ id: courier.id, name: courier.name })}
          className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left text-sm transition-colors ${
            chosen?.id === courier.id ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "hover:bg-[var(--surface-2)]"
          }`}>
          <input type="radio" readOnly checked={chosen?.id === courier.id} className="shrink-0" tabIndex={-1}
            aria-label={`${courier.name}, ${formatRupees(courier.rate)}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{courier.name}</span>
            <span className="block text-xs text-[var(--muted)]">
              {courier.surface ? "Surface" : "Air"}
              {courier.days ? ` · ${courier.days} day${courier.days === 1 ? "" : "s"}` : ""}
              {courier.etd ? ` · by ${courier.etd}` : ""}
              {courier.rating ? ` · rated ${courier.rating.toFixed(1)}` : ""}
            </span>
          </span>
          {courier.recommended && <Badge tone="info">Shiprocket&rsquo;s pick</Badge>}
          <span className="shrink-0 text-right">
            <span className="block font-semibold tabular-nums">{formatRupees(courier.rate)}</span>
            {/* What choosing this one costs over the cheapest — the figure the
                decision is actually about, and one nobody should do in their head. */}
            <span className="block text-xs text-[var(--muted)]">
              {courier.rate > cheapest ? `+${formatRupees(courier.rate - cheapest)}` : "cheapest"}
            </span>
          </span>
        </button>
      ))}
    </div>

    <div className="flex items-center justify-between text-xs text-[var(--muted)]">
      <span>{couriers.length} couriers serve this address. Freight shown is what Shiprocket charges, all in.</span>
      <button type="button" onClick={onQuote} className="inline-flex items-center gap-1 font-medium text-[var(--brand)] hover:underline">
        <RefreshCw size={12} className={quoting ? "animate-spin" : ""} />Refresh rates
      </button>
    </div>
  </div>;
}

/**
 * The delivery address, for one order.
 *
 * Editable rather than displayed, because the reason an order cannot be booked
 * is very often that the checkout never collected a street — the Fastrr import
 * carries a city and a phone and nothing else. What is typed here is saved onto
 * the order, not merely sent to the courier: the next person to open it should
 * see the address it actually shipped to.
 */
function AddressFields({ order, address, onChange, note, busy, onFetch }: {
  order: SalesOrderRecord;
  address: Address;
  onChange: (address: Address) => void;
  /** What the last fetch from the shop had to say, if anything. */
  note?: string;
  busy?: boolean;
  onFetch: () => void;
}) {
  const set = (field: keyof Address) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...address, [field]: event.target.value });

  const missing = new Set(missingFields(address));
  const mark = (field: string) => missing.has(field) ? "input border-[var(--danger-line)]" : "input";

  return <div className="space-y-3 rounded-[10px] border border-[var(--line)] p-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="flex flex-1 items-center gap-2 text-[13px] font-semibold">
        Delivering to
        <Badge tone={paymentModeOf(order) === "COD" ? "warn" : "neutral"}>
          {paymentModeOf(order) === "COD" ? `COD ${formatRupees(order.totals.paid)}` : "Prepaid"}
        </Badge>
      </p>
      {/*
        * Orders placed before this system booked parcels kept only the city, the
        * state and the pin code. Shopify has had the street all along, so it is
        * fetched when the dialog opens — and this is how to ask again.
        */}
      <button type="button" onClick={onFetch} disabled={busy}
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Fetch from the shop
      </button>
    </div>

    {note && <p className="text-xs text-[var(--muted)]">{note}</p>}

    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name"><input className={mark("customer name")} value={address.name ?? ""} onChange={set("name")} /></Field>
      <Field label="Phone" hint="Ten digits — anything else is refused by the courier.">
        <input className={mark("10-digit phone number")} value={address.phone ?? ""} onChange={set("phone")} />
      </Field>
    </div>
    <Field label="Street address"><input className={mark("street address")} value={address.address1 ?? ""} onChange={set("address1")} /></Field>
    <Field label="Landmark, flat, floor"><input className="input" value={address.address2 ?? ""} onChange={set("address2")} /></Field>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="City"><input className={mark("city")} value={address.city ?? ""} onChange={set("city")} /></Field>
      <Field label="State"><input className={mark("state")} value={address.state ?? ""} onChange={set("state")} /></Field>
      <Field label="Pin code"><input className={mark("6-digit pin code")} inputMode="numeric" value={address.pinCode ?? ""} onChange={set("pinCode")} /></Field>
    </div>
    <Field label="Email" hint="Where Shiprocket sends the tracking link.">
      <input className="input" value={address.email ?? ""} onChange={set("email")} />
    </Field>
  </div>;
}

/** What a run did, order by order, with the paperwork for whatever worked. */
function ResultsDialog({ results, onClose }: { results: ProcessResult[]; onClose: () => void }) {
  const booked = results.filter(result => result.ok);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function download(kind: "invoice" | "label") {
    setBusy(true);
    const outcome = await downloadDocuments(kind, booked.map(result => result.orderId));
    setNotice(outcome.message);
    setBusy(false);
  }

  return <Modal title={booked.length === results.length ? "Booked" : `Booked ${booked.length} of ${results.length}`}
    description="Every order in the run, and what became of it."
    onClose={onClose}
    footer={<div className="flex gap-2">
      {booked.length > 0 && <>
        <Button tone="secondary" className="flex-1" busy={busy} onClick={() => download("invoice")}>
          <Download size={16} />Invoices
        </Button>
        <Button tone="secondary" className="flex-1" busy={busy} onClick={() => download("label")}>
          <Download size={16} />Labels
        </Button>
      </>}
      <Button className="flex-1" onClick={onClose}>Done</Button>
    </div>}>

    <div className="space-y-2">
      {notice && <Notice tone="info">{notice}</Notice>}
      {results.map(result => (
        <div key={result.orderId} className="flex items-start gap-2 border-b border-[var(--line)] pb-2 text-sm last:border-0">
          {result.ok
            ? <Check size={16} className="mt-0.5 shrink-0 text-[var(--ok-ink)]" />
            : <X size={16} className="mt-0.5 shrink-0 text-[var(--danger-ink)]" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{result.name || "Order"}</p>
            <p className="text-xs text-[var(--muted)]">
              {result.ok ? `${result.courier || "Booked"} · AWB ${result.awb}` : result.error}
            </p>
          </div>
        </div>
      ))}
    </div>
  </Modal>;
}

// ------------------------------------------------------------------ downloads

/**
 * The invoice or label PDF, saved to the machine.
 *
 * Fetched rather than linked, for the one reason that decides it: this endpoint
 * answers with a PDF when it works and with JSON when it does not, and a plain
 * link would navigate the operator away from their selection to look at
 * `{"error":"…"}` on a blank page. Fetching keeps the failure on the screen they
 * are working on.
 */
export async function downloadDocuments(kind: "invoice" | "label", orderIds: string[]): Promise<{ ok: boolean; message: string }> {
  if (!orderIds.length) return { ok: false, message: "Choose at least one order first." };

  try {
    const response = await fetch(`/api/sales/orders/documents?ids=${orderIds.join(",")}&doc=${kind}`);
    if (!response.ok) {
      const json = await response.json().catch(() => ({})) as { error?: string };
      return { ok: false, message: json.error ?? `Could not fetch the ${kind}.` };
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileNameFrom(response.headers.get("content-disposition")) ?? `${kind}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoked late rather than immediately: the download is started by the click
    // above but not necessarily finished by the time this line runs.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);

    const included = Number(response.headers.get("x-orders-included") ?? orderIds.length);
    const skipped = Number(response.headers.get("x-orders-skipped") ?? 0);
    return {
      ok: true,
      message: skipped
        ? `Downloaded ${orderCount(included)}. ${orderCount(skipped)} had no ${kind} yet and ${skipped === 1 ? "was" : "were"} left out.`
        : `Downloaded ${orderCount(included)}.`
    };
  } catch {
    return { ok: false, message: `Could not download the ${kind}. Check the connection and try again.` };
  }
}

/** The filename the server chose, so a folder of invoices is named after its orders. */
function fileNameFrom(header: string | null): string | undefined {
  const match = /filename="?([^"]+)"?/i.exec(header ?? "");
  return match?.[1];
}
