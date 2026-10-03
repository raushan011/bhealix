"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarClock, ExternalLink, Phone, ShieldAlert, FileText, MapPin, MessageCircle, Pencil, RefreshCw, StickyNote, Tag, Truck, Undo2, Wallet, XCircle } from "lucide-react";
import { telUrl, whatsappUrl } from "@/lib/sales/leads";
import { needsAction, riskTone } from "@/lib/sales-team/risk";
import { Badge, Button, Card, Field, Notice, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { DELIVERY_STATES, type CourierRule, type DeliveryState } from "@/lib/sales/constants";
import { deliveryTone } from "@/lib/sales/delivery";
import { processTone, type CourierOption, type PickupLocation } from "@/lib/sales/fulfilment";
import type { ProcessState } from "@/lib/sales/constants";
import type { Tracking } from "@/lib/sales/shiprocket";
import { describeRule, formatRupees, incentiveTone, PAYMENT_MODE_LABEL } from "@/lib/sales-team/orders";
import { formatDate, formatDateTime, shiftDay, todayIso } from "@/lib/time";
import { call, executiveNameOf, messageOf, paymentLine, PayIncentiveModal, type TeamOrderRow } from "./shared";

type Payload = {
  order: TeamOrderRow;
  processState: ProcessState;
  shopifyUrl?: string;
  may: { edit: boolean; cancel: boolean; book: boolean; track: boolean; documents: boolean; override: boolean; reassign: boolean; pay: boolean; ndr?: boolean };
};

/**
 * One sales order, from placed to paid.
 *
 * Everything an executive does after closing the sale happens here: check it,
 * book it with the courier, print the invoice and label, follow the parcel. The
 * administrator sees the same screen with three more controls — correct the
 * delivery, move the order to another executive, and pay the incentive.
 */
export function OrderDetail({ id, basePath }: { id: string; basePath: string }) {
  const placed = useSearchParams().get("placed") === "1";
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(placed ? { tone: "success", text: "Order placed. Check the details, then book it with the courier." } : null);
  const [dialog, setDialog] = useState<"book" | "cancel" | "override" | "reassign" | "pay" | "undo" | "ndr" | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await call<Payload>(`/api/sales-team/orders/${id}`));
    } catch (problem) {
      setError(messageOf(problem));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function track() {
    setTrackingBusy(true);
    try {
      const result = await call<{ tracking: Tracking }>(`/api/sales-team/orders/${id}/track`);
      setTracking(result.tracking);
      await load();
    } catch (problem) {
      setNotice({ tone: "error", text: messageOf(problem) });
    } finally {
      setTrackingBusy(false);
    }
  }

  const done = (text: string) => { setDialog(null); setNotice({ tone: "success", text }); load(); };

  if (error) return <div className="space-y-4"><BackLink basePath={basePath} /><Notice tone="error">{error}</Notice></div>;
  if (!data) return <Spinner label="Loading the order…" />;

  const { order, may, processState, shopifyUrl } = data;
  // A failed delivery waiting on an instruction — the one state a phone call today can rescue.
  const failedAttempt = Boolean(order.shipment?.awb) && needsAction(order.shipment?.status, order.delivery.state);
  const mayAct = Boolean(may.ndr);
  // The courier's public page, shareable with the customer the moment an airway bill exists.
  const trackUrl = tracking?.trackUrl ?? (order.shipment?.awb ? `https://shiprocket.co/tracking/${encodeURIComponent(order.shipment.awb)}` : undefined);
  const shareUrl = trackUrl && whatsappUrl(order.customer.phone)
    ? `${whatsappUrl(order.customer.phone)}?text=${encodeURIComponent(`Hello ${order.customer.name?.split(" ")[0] ?? ""}, your BHEALIX order ${order.name} is on its way${order.shipment?.courier ? ` with ${order.shipment.courier}` : ""}. Track it here: ${trackUrl}`)}`
    : undefined;
  const cancelled = Boolean(order.cancelledAt);
  const shipment = order.shipment ?? {};

  return <div className="space-y-5">
    <BackLink basePath={basePath} />

    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] sm:text-2xl">{order.name}</h1>
          {cancelled ? <Badge tone="danger">Cancelled</Badge> : <Badge tone={processTone(processState)}>{processState}</Badge>}
          {!cancelled && <Badge tone={deliveryTone(order.delivery.state)}>{order.delivery.state}</Badge>}
          {order.channel === "Shopify" && <Badge tone="info">In Shopify</Badge>}
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {formatDateTime(order.placedAt)} · {executiveNameOf(order)}
          {order.ref && order.ref !== order.name ? ` · ${order.ref}` : ""}
          {order.createdBy && order.createdBy.name !== executiveNameOf(order) ? ` · placed by ${order.createdBy.name}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {may.book && <Button onClick={() => setDialog("book")}><Truck size={16} />Book with courier</Button>}
        {shopifyUrl && <a href={shopifyUrl} target="_blank" rel="noreferrer" className="tap inline-flex items-center gap-2 rounded-[10px] border border-[var(--line-2)] px-4 text-sm font-semibold hover:bg-[var(--surface-2)]"><ExternalLink size={15} />Open in Shopify</a>}
        {may.edit && <Link href={`${basePath}/${order._id}/edit`} className="tap inline-flex items-center gap-2 rounded-[10px] border border-[var(--line-2)] px-4 text-sm font-semibold hover:bg-[var(--surface-2)]"><Pencil size={15} />Edit</Link>}
        {may.cancel && <Button tone="danger" onClick={() => setDialog("cancel")}><XCircle size={16} />Cancel</Button>}
      </div>
    </header>

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {cancelled && <Notice tone="error">Cancelled {order.cancelledAt ? formatDate(order.cancelledAt) : ""}{order.cancelledBy ? ` by ${order.cancelledBy.name}` : ""}: {order.cancelReason}</Notice>}
    {shipment.lastError && !shipment.awb && <Notice tone="error">The last booking attempt failed: {shipment.lastError}</Notice>}

    {failedAttempt && may.book === false && !cancelled && (
      <Card className="space-y-3 border-[var(--danger-line)] p-4">
        <p className="text-sm font-semibold text-[var(--danger-ink)]">The courier could not deliver this parcel{shipment.status ? ` (${shipment.status})` : ""}.</p>
        <p className="text-xs text-[var(--muted)]">Ring the customer, agree a day, then send the courier back — or have it returned. Left alone, it goes back as a return.</p>
        <div className="grid grid-cols-2 gap-2">
          {telUrl(order.customer.phone) && <a href={telUrl(order.customer.phone)!} className="tap inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] text-sm font-semibold"><Phone size={15} />Call customer</a>}
          {mayAct && <Button onClick={() => setDialog("ndr")}><CalendarClock size={15} />Reattempt / reschedule</Button>}
        </div>
      </Card>
    )}

    <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="space-y-5">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><MapPin size={16} />Deliver to</h2>
          <p className="mt-3 text-sm font-semibold">{order.customer.name}</p>
          <p className="text-sm text-[var(--ink-2)]">{[order.customer.address1, order.customer.address2].filter(Boolean).join(", ")}</p>
          <p className="text-sm text-[var(--ink-2)]">{[order.customer.city, order.customer.state, order.customer.pinCode].filter(Boolean).join(", ")}</p>
          <p className="mt-1 text-sm">
            <a href={`tel:${order.customer.phone}`} className="text-[var(--brand)] hover:underline">{order.customer.phone}</a>
            {order.customer.email ? ` · ${order.customer.email}` : ""}
          </p>
          {order.lead && typeof order.lead === "object" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]"><Tag size={12} />From the lead {order.lead.name}{order.lead.type ? ` (${order.lead.type})` : ""}</p>
          )}
          {order.notes && <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--muted)]"><StickyNote size={12} className="mt-0.5" />{order.notes}</p>}
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Products</h2>
          <div className="mt-3 divide-y divide-[var(--line)]">
            {order.items.map((item, index) => (
              <div key={index} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">{item.title} <span className="text-[var(--muted)]">× {item.quantity}{item.price ? ` · MRP ${formatRupees(item.price)}` : item.catalogueId === "free-bag" ? " · free" : ""}</span></span>
                <span className="shrink-0 tabular-nums">{formatRupees(item.gross ?? 0)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3 text-sm">
            {order.pricing?.mrpTotal ? <>
              {order.pricing.mrpTotal > (order.pricing.offerTotal ?? 0) && <Line label={`${order.pricing.label ?? "Handbook"} offer`} value={`− ${formatRupees(order.pricing.mrpTotal - (order.pricing.offerTotal ?? 0))}`} />}
              {Boolean(order.pricing.prepaidOff) && <Line label="Prepaid" value={`− ${formatRupees(order.pricing.prepaidOff ?? 0)}`} />}
              {Boolean(order.pricing.extraOff) && <Line label="Extra discount released" value={`− ${formatRupees(order.pricing.extraOff ?? 0)}`} />}
            </> : order.totals.discount > 0 && <Line label="Discount" value={`− ${formatRupees(order.totals.discount)}`} />}
            <Line label="Order total" value={formatRupees(order.totals.paid)} strong />
            <Line label={PAYMENT_MODE_LABEL[order.paymentMode]} value={order.paymentMode === "COD" ? "Collected on delivery" : `${formatRupees(order.advancePaid ?? 0)} paid up front`} />
            <Line label="Courier collects" value={formatRupees(order.collectAmount ?? 0)} strong />
            {order.paymentReference && <Line label="Payment reference" value={order.paymentReference} />}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Truck size={16} />Shipment</h2>
            <div className="flex flex-wrap gap-2">
              {may.track && <Button tone="secondary" className="!min-h-[36px] text-xs" busy={trackingBusy} onClick={track}><RefreshCw size={14} />Track</Button>}
              {shareUrl && <a href={shareUrl} target="_blank" rel="noreferrer" className="tap inline-flex !min-h-[36px] items-center gap-1.5 rounded-[10px] border border-[var(--ok-line)] px-3 text-xs font-semibold text-[var(--ok-ink)] hover:bg-[var(--ok-bg)]"><MessageCircle size={14} />Send tracking</a>}
              {may.documents && <a href={`/api/sales-team/orders/${order._id}/documents?doc=invoice`} className="tap inline-flex !min-h-[36px] items-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold hover:bg-[var(--surface-2)]"><FileText size={14} />Invoice</a>}
              {may.documents && shipment.awb && <a href={`/api/sales-team/orders/${order._id}/documents?doc=label`} className="tap inline-flex !min-h-[36px] items-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold hover:bg-[var(--surface-2)]"><FileText size={14} />Label</a>}
            </div>
          </div>
          {shipment.shiprocketOrderId ? (
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Detail label="Courier" value={shipment.courier || "Not assigned yet"} />
              <Detail label="AWB" value={shipment.awb || "Not assigned yet"} />
              <Detail label="Shiprocket says" value={shipment.status || "Nothing yet"} />
              <Detail label="Shiprocket order" value={shipment.shiprocketOrderId} />
              {shipment.pickupLocation && <Detail label="Ships from" value={shipment.pickupLocation} />}
              {shipment.pickupScheduledAt && <Detail label="Pickup" value={formatDateTime(shipment.pickupScheduledAt)} />}
              {shipment.processedAt && <Detail label="Booked" value={`${formatDateTime(shipment.processedAt)}${shipment.processedBy ? ` by ${shipment.processedBy.name}` : ""}`} />}
              {shipment.deliveredAt && <Detail label="Delivered" value={formatDateTime(shipment.deliveredAt)} />}
              {order.delivery.override && <Detail label="Corrected by hand" value={`${order.delivery.override}${order.delivery.overrideReason ? ` — ${order.delivery.overrideReason}` : ""}`} />}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">{cancelled ? "This order was never sent to the courier." : "Not booked with the courier yet."}</p>
          )}
          {tracking && (
            <div className="mt-4 rounded-[10px] bg-[var(--surface-2)] p-3">
              <p className="text-xs text-[var(--muted)]">{tracking.status ?? "No status yet"}{tracking.trackUrl ? <> · <a href={tracking.trackUrl} target="_blank" rel="noreferrer" className="text-[var(--brand)] underline">Public tracking link</a></> : null}</p>
              {tracking.note && <p className="mt-1 text-sm">{tracking.note}</p>}
              <ol className="mt-2 space-y-2">
                {tracking.scans.slice(0, 12).map((scan, index) => (
                  <li key={index} className="text-sm"><span className="font-medium">{scan.activity}</span><span className="block text-xs text-[var(--muted)]">{[scan.location, scan.at].filter(Boolean).join(" · ")}</span></li>
                ))}
              </ol>
            </div>
          )}
          {(may.override || may.reassign) && (
            <div className="mt-4 flex flex-wrap gap-3 border-t border-[var(--line)] pt-3">
              {may.override && <button onClick={() => setDialog("override")} className="text-xs font-semibold text-[var(--brand)] hover:underline">Correct the delivery</button>}
              {may.reassign && <button onClick={() => setDialog("reassign")} className="text-xs font-semibold text-[var(--brand)] hover:underline">Move to another executive</button>}
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-5">
      {order.rtoRisk?.level && (
        <Card className="space-y-2 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><ShieldAlert size={16} />RTO risk</h2>
            <Badge tone={riskTone(order.rtoRisk.level)}>{order.rtoRisk.level}{order.rtoRisk.score != null ? ` · ${order.rtoRisk.score}/100` : ""}</Badge>
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--ink-2)]">{(order.rtoRisk.reasons ?? []).map(reason => <li key={reason}>{reason}</li>)}</ul>
          {order.rtoRisk.advice && <p className="text-xs font-semibold text-[var(--ink-2)]">{order.rtoRisk.advice}</p>}
          <p className="text-[11px] text-[var(--muted)]">As assessed when the order was placed.</p>
        </Card>
      )}

      {Boolean(order.ndr?.length) && (
        <Card className="space-y-2 p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><CalendarClock size={16} />Delivery instructions sent</h2>
          {[...(order.ndr ?? [])].reverse().map(entry => (
            <div key={entry._id} className="rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-xs">
              <p className="font-semibold">{entry.action === "return" ? "Return to us" : `Reattempt${entry.deferredDate ? ` on ${formatDate(entry.deferredDate)}` : ""}`}
                {" "}<span className={entry.ok ? "text-[var(--ok-ink)]" : "text-[var(--danger-ink)]"}>{entry.ok ? "· accepted" : "· refused"}</span></p>
              <p className="text-[var(--ink-2)]">{entry.comments}</p>
              {entry.response && <p className="text-[var(--muted)]">Shiprocket: {entry.response}</p>}
              <p className="text-[var(--muted)]">{formatDateTime(entry.at)}{entry.byName ? ` · ${entry.byName}` : ""}</p>
            </div>
          ))}
          {mayAct && !cancelled && shipment.awb && !["Delivered", "RTO", "Returned"].includes(order.delivery.state) && !failedAttempt && (
            <button onClick={() => setDialog("ndr")} className="text-xs font-semibold text-[var(--brand)]">Send another instruction</button>
          )}
        </Card>
      )}

      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Wallet size={16} />Incentive</h2>
        <div className="flex items-center justify-between">
          <p className="text-2xl font-semibold tabular-nums">{formatRupees(order.incentive.amount)}</p>
          <Badge tone={incentiveTone(order.incentive.status)}>{order.incentive.status}</Badge>
        </div>
        <p className="text-xs text-[var(--muted)]">
          {describeRule({ enabled: order.incentive.enabled !== false, type: order.incentive.type ?? "Percentage", value: order.incentive.value ?? 0 })}
          {" "}· {PAYMENT_MODE_LABEL[order.paymentMode].toLowerCase()} rule, fixed when the order was placed
        </p>
        {order.incentive.reason && <p className="text-sm text-[var(--ink-2)]">{order.incentive.reason}</p>}
        {order.incentive.needsReversal && <Notice tone="warning">This incentive was paid, and the order was later cancelled or returned. Recover it from the executive by agreement — the paid record is never rewritten.</Notice>}
        {order.incentive.status === "Paid" && order.incentive.payment && (
          <p className="text-sm text-[var(--ok-ink)]">Paid {paymentLine(order.incentive.payment)}{order.incentive.payment.paidBy ? ` · marked by ${order.incentive.payment.paidBy.name}` : ""}</p>
        )}
        {may.pay && order.incentive.status === "Payable" && <Button className="w-full" onClick={() => setDialog("pay")}><Wallet size={16} />Mark paid</Button>}
        {may.pay && order.incentive.status === "Paid" && <Button tone="secondary" className="w-full" onClick={() => setDialog("undo")}><Undo2 size={16} />Undo payment</Button>}
      </Card>
      </div>
    </div>

    {dialog === "ndr" && <NdrDialog order={order} onClose={() => setDialog(null)} onSent={text => done(text)} />}
    {dialog === "book" && <BookDialog order={order} onClose={() => setDialog(null)} onBooked={text => done(text)} />}
    {dialog === "cancel" && <ReasonDialog title={`Cancel ${order.name}`} label="Why is it being cancelled?" action="Cancel order" danger
      onClose={() => setDialog(null)}
      onSubmit={async reason => { await call(`/api/sales-team/orders/${order._id}`, { method: "PATCH", body: { action: "cancel", reason } }); done("Order cancelled."); }} />}
    {dialog === "undo" && <ReasonDialog title="Undo this payment" label="Why is it being undone?" action="Undo payment"
      onClose={() => setDialog(null)}
      onSubmit={async reason => { await call("/api/sales-team/incentives", { body: { action: "undo", orderId: order._id, reason } }); done("Payment undone. The incentive has been re-priced."); }} />}
    {dialog === "override" && <OverrideDialog order={order} onClose={() => setDialog(null)} onSaved={() => done("Delivery corrected. The incentive follows it.")} />}
    {dialog === "reassign" && <ReassignDialog order={order} onClose={() => setDialog(null)} onSaved={name => done(`Order moved to ${name}.`)} />}
    {dialog === "pay" && <PayIncentiveModal orders={[{ _id: order._id, name: order.name, amount: order.incentive.amount, executive: executiveNameOf(order) }]}
      onClose={() => setDialog(null)} onPaid={text => done(text)} />}
  </div>;
}

function BackLink({ basePath }: { basePath: string }) {
  return <Link href={basePath} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]"><ArrowLeft size={16} />Orders</Link>;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-[var(--muted)]">{label}</span><span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="wrap-break-word">{value}</dd></div>;
}

/**
 * Booking the parcel: the warehouse, the carton, and a courier.
 *
 * The rates are fetched as the dialog opens and listed cheapest first, because
 * freight is money — the same reasoning as the Affiliate CRM's processing
 * screen. They are asked for again when the warehouse or weight changes, by a
 * button rather than a keystroke.
 */
function BookDialog({ order, onClose, onBooked }: { order: TeamOrderRow; onClose: () => void; onBooked: (text: string) => void }) {
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [refusal, setRefusal] = useState("");
  const [pickup, setPickup] = useState("");
  const [parcel, setParcel] = useState({ weight: 0.5, length: 20, breadth: 15, height: 8 });
  const [couriers, setCouriers] = useState<CourierOption[] | null>(null);
  const [choice, setChoice] = useState<string>("recommended");
  const [schedule, setSchedule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rates = useCallback(async (location: string, weight: number) => {
    if (!location) return;
    setRating(true); setError("");
    try {
      const result = await call<{ couriers: CourierOption[] }>("/api/sales-team/fulfilment", { body: { orderId: order._id, pickupLocation: location, weight } });
      setCouriers(result.couriers);
    } catch (problem) {
      setCouriers([]);
      setError(messageOf(problem));
    } finally {
      setRating(false);
    }
  }, [order._id]);

  useEffect(() => {
    (async () => {
      try {
        const options = await call<{ locations: PickupLocation[]; parcel: typeof parcel; defaults: { pickupLocation?: string; courierRule?: string; courierId?: number }; refusal?: string }>("/api/sales-team/fulfilment");
        setLocations(options.locations);
        setRefusal(options.refusal ?? "");
        setParcel(options.parcel);
        const start = options.locations.find(location => location.name === options.defaults.pickupLocation)?.name ?? options.locations[0]?.name ?? "";
        setPickup(start);
        if (start) await rates(start, options.parcel.weight);
      } catch (problem) {
        setError(messageOf(problem));
      } finally {
        setLoading(false);
      }
    })();
  }, [rates]);

  async function book() {
    setBusy(true); setError("");
    const named = Number(choice);
    const courier = Number.isFinite(named) && named > 0 ? couriers?.find(option => option.id === named) : undefined;
    try {
      const result = await call<{ awb?: string; courier?: string }>(`/api/sales-team/orders/${order._id}/book`, {
        body: {
          pickupLocation: pickup, parcel, schedulePickup: schedule,
          ...(courier ? { courierId: courier.id, courierName: courier.name } : { courierRule: choice as CourierRule })
        }
      });
      onBooked(`Booked on ${result.courier ?? "the courier"} — AWB ${result.awb ?? ""}.`);
    } catch (problem) {
      setError(messageOf(problem));
      setBusy(false);
    }
  }

  const cheapest = couriers?.[0]?.rate ?? 0;

  return <Modal title={`Book ${order.name}`} description={`${order.customer.city ?? ""} ${order.customer.pinCode ?? ""} · courier collects ${formatRupees(order.collectAmount ?? 0)}`} onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Not now</Button>
      <Button className="flex-1" busy={busy} disabled={!pickup || Boolean(refusal)} onClick={book}><Truck size={16} />Book</Button>
    </div>}>
    {loading ? <Spinner label="Asking Shiprocket…" /> : <div className="space-y-4">
      {refusal && <Notice tone="error">{refusal}</Notice>}
      {!refusal && <>
        <Field label="Ships from">
          <select className="select" value={pickup} onChange={event => { setPickup(event.target.value); rates(event.target.value, parcel.weight); }}>
            {locations.map(location => <option key={location.name} value={location.name}>{location.name}{location.city ? ` — ${location.city}` : ""}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-4 gap-2">
          {(["weight", "length", "breadth", "height"] as const).map(key => (
            <Field key={key} label={key === "weight" ? "kg" : `${key[0].toUpperCase()}${key.slice(1)} cm`}>
              <input className="input" type="number" min={0.1} step="0.1" value={parcel[key]} onChange={event => setParcel({ ...parcel, [key]: Number(event.target.value) || 0 })} />
            </Field>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Courier</p>
          <button onClick={() => rates(pickup, parcel.weight)} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"><RefreshCw size={12} className={rating ? "animate-spin" : ""} />Refresh rates</button>
        </div>
        <div className="max-h-[260px] space-y-1.5 overflow-y-auto">
          {(["recommended", "cheapest", "fastest"] as const).map(rule => (
            <label key={rule} className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2 text-sm ${choice === rule ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)]"}`}>
              <input type="radio" checked={choice === rule} onChange={() => setChoice(rule)} />
              <span className="font-medium capitalize">{rule === "recommended" ? "Shiprocket's recommendation" : `The ${rule}`}</span>
            </label>
          ))}
          {couriers?.map(courier => (
            <label key={courier.id} className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2 text-sm ${choice === String(courier.id) ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)]"}`}>
              <input type="radio" checked={choice === String(courier.id)} onChange={() => setChoice(String(courier.id))} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{courier.name}</span>
                {courier.recommended && <span className="ml-1.5 text-xs text-[var(--ok-ink)]">recommended</span>}
                <span className="block text-xs text-[var(--muted)]">{courier.etd ?? (courier.days ? `${courier.days} days` : "")}{courier.surface ? " · surface" : ""}</span>
              </span>
              <span className="text-right tabular-nums">
                {formatRupees(courier.rate)}
                {courier.rate > cheapest && <span className="block text-xs text-[var(--muted)]">+{formatRupees(courier.rate - cheapest)}</span>}
              </span>
            </label>
          ))}
          {couriers && !couriers.length && !rating && <p className="text-sm text-[var(--muted)]">No courier reaches this pin code at this weight.</p>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={schedule} onChange={event => setSchedule(event.target.checked)} />Ask the courier for a pickup</label>
      </>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>}
  </Modal>;
}

function ReasonDialog({ title, label, action, danger, onClose, onSubmit }: {
  title: string; label: string; action: string; danger?: boolean;
  onClose: () => void; onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { await onSubmit(reason); } catch (problem) { setError(messageOf(problem)); setBusy(false); }
  }
  return <Modal title={title} onClose={onClose} footer={<div className="flex gap-2">
    <Button tone="secondary" className="flex-1" onClick={onClose}>Back</Button>
    <Button tone={danger ? "danger" : "primary"} className="flex-1" busy={busy} disabled={reason.trim().length < 3} onClick={submit}>{action}</Button>
  </div>}>
    <div className="space-y-4">
      <Field label={label} hint="Recorded with your name and the date."><textarea className="textarea" rows={2} value={reason} onChange={event => setReason(event.target.value)} /></Field>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

function OverrideDialog({ order, onClose, onSaved }: { order: TeamOrderRow; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState<DeliveryState | "">(order.delivery.override ?? "");
  const [reason, setReason] = useState(order.delivery.overrideReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      await call(`/api/sales-team/orders/${order._id}`, { method: "PATCH", body: { action: "override", state: state || null, reason: reason || undefined } });
      onSaved();
    } catch (problem) { setError(messageOf(problem)); setBusy(false); }
  }
  return <Modal title={`Correct ${order.name}`} description={`The courier reports "${order.shipment?.status ?? "nothing yet"}" — read as ${order.delivery.reported ?? "Awaiting"}`} onClose={onClose}
    footer={<div className="flex gap-2"><Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" busy={busy} onClick={save}>Save correction</Button></div>}>
    <div className="space-y-4">
      <Field label="What actually happened" hint="Leave it on the courier's answer to clear a correction.">
        <select className="select" value={state} onChange={event => setState(event.target.value as DeliveryState | "")}>
          <option value="">Use the courier&rsquo;s answer ({order.delivery.reported ?? "Awaiting"})</option>
          {DELIVERY_STATES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Why"><textarea className="textarea" rows={2} value={reason} onChange={event => setReason(event.target.value)} /></Field>
      {order.incentive.status === "Paid" && <Notice tone="warning">The incentive has already been paid, so its figure will not change; a correction that voids it flags it for recovery instead.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

function ReassignDialog({ order, onClose, onSaved }: { order: TeamOrderRow; onClose: () => void; onSaved: (name: string) => void }) {
  const [people, setPeople] = useState<Array<{ _id: string; name: string }>>([]);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { call<{ items: Array<{ _id: string; name: string }> }>("/api/sales-team/executives").then(result => setPeople(result.items)).catch(problem => setError(messageOf(problem))); }, []);
  async function save() {
    setBusy(true); setError("");
    try {
      await call(`/api/sales-team/orders/${order._id}`, { method: "PATCH", body: { action: "reassign", executive: chosen } });
      onSaved(people.find(person => person._id === chosen)?.name ?? "the new executive");
    } catch (problem) { setError(messageOf(problem)); setBusy(false); }
  }
  return <Modal title={`Move ${order.name}`} description={`Currently ${executiveNameOf(order)}'s. The incentive moves with it.`} onClose={onClose}
    footer={<div className="flex gap-2"><Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" busy={busy} disabled={!chosen} onClick={save}>Move order</Button></div>}>
    <div className="space-y-4">
      <Field label="To">
        <select className="select" value={chosen} onChange={event => setChosen(event.target.value)}>
          <option value="">Choose…</option>
          {people.map(person => <option key={person._id} value={person._id}>{person.name}</option>)}
        </select>
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}


/**
 * What to tell the courier about a failed delivery, as agreed with the
 * customer: come back (on a day they chose, to a corrected phone or address),
 * or bring it back to us.
 */
function NdrDialog({ order, onClose, onSent }: { order: TeamOrderRow; onClose: () => void; onSent: (text: string) => void }) {
  const today = todayIso();
  const [action, setAction] = useState<"re-attempt" | "return">("re-attempt");
  const [day, setDay] = useState(shiftDay(today, 1));
  const [phone, setPhone] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true); setError("");
    try {
      const result = await call<{ message: string }>(`/api/sales-team/orders/${order._id}/ndr`, {
        body: { action, comments, ...(action === "re-attempt" ? { deferredDate: day || undefined, phone, address1, address2 } : {}) }
      });
      onSent(action === "return" ? `Return requested. ${result.message}` : `Reattempt requested${day ? ` for ${formatDate(day)}` : ""}. ${result.message}`);
    } catch (problem) { setError(messageOf(problem)); setBusy(false); }
  }

  return <Modal title={`Failed delivery — ${order.name}`} description={`${order.customer.name} · ${order.customer.phone}`} onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Back</Button>
      <Button tone={action === "return" ? "danger" : "primary"} className="flex-1" busy={busy} disabled={comments.trim().length < 3} onClick={send}>
        {action === "return" ? "Return it" : "Send courier again"}
      </Button>
    </div>}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {([["re-attempt", "Deliver again"], ["return", "Return to us"]] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setAction(value)}
            className={`tap rounded-[10px] border text-sm font-semibold ${action === value ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line-2)]"}`}>{label}</button>
        ))}
      </div>
      {action === "re-attempt" && <>
        <Field label="Deliver on" hint="The day the customer asked for. Clear it for the courier's next round.">
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2].map(offset => {
              const value = shiftDay(today, offset);
              return <button key={value} type="button" onClick={() => setDay(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${day === value ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)]"}`}>
                {offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : formatDate(value)}
              </button>;
            })}
          </div>
          <input type="date" className="input mt-2" min={today} value={day} onChange={event => setDay(event.target.value)} />
        </Field>
        <Field label="New phone (if the customer gave another)"><input className="input" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} /></Field>
        <Field label="Corrected address (only if it was wrong)">
          <input className="input" value={address1} onChange={event => setAddress1(event.target.value)} placeholder="House, street" />
          <input className="input mt-2" value={address2} onChange={event => setAddress2(event.target.value)} placeholder="Landmark" />
        </Field>
      </>}
      <Field label="What the customer said" hint="Sent to the courier with the request.">
        <textarea className="textarea" rows={2} value={comments} onChange={event => setComments(event.target.value)}
          placeholder={action === "return" ? "Customer refused — no longer wants it." : "Customer was out; will be home after 4 pm."} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
