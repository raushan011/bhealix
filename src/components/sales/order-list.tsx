"use client";

import { useState } from "react";
import { AlertTriangle, PackageSearch, SlidersHorizontal } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/time";
import { commissionTone, deliveryTone } from "@/lib/sales/delivery";
import { DELIVERY_STATES, type DeliveryState } from "@/lib/sales/constants";
import { formatRupees, type SalesOrderRecord } from "@/lib/sales/types";

/**
 * Attributed orders, and the one control that can change what they pay.
 *
 * Each row carries two badges because they answer different questions: the
 * delivery state is what the courier says happened, and the commission status is
 * what that means for money. They are usually consistent and it is precisely the
 * cases where they are not — delivered but still maturing, delivered but voided
 * by a refund — that somebody is looking for.
 */
export function OrderList({ orders, mayOverride, onChanged, showRep = true }: {
  orders: SalesOrderRecord[];
  mayOverride: boolean;
  onChanged?: () => void;
  showRep?: boolean;
}) {
  const [editing, setEditing] = useState<SalesOrderRecord | null>(null);

  if (!orders.length) {
    return <EmptyState icon={PackageSearch} title="No orders here"
      description="Orders appear once a coupon belonging to one of your partners is used and a sync has run." />;
  }

  return <>
    <Card className="divide-y divide-[var(--line)]">
      {orders.map(order => {
        const rep = typeof order.rep === "object" && order.rep ? order.rep : null;
        return <div key={order._id} className="flex flex-wrap items-start gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{order.name}</p>
              <Badge tone={deliveryTone(order.delivery.state)}>{order.delivery.state}</Badge>
              <Badge tone={commissionTone(order.commission.status)}>{order.commission.status}</Badge>
              {order.delivery.override && <Badge tone="info">Set by hand</Badge>}
              {order.commission.needsReversal && <Badge tone="danger">Needs reversal</Badge>}
              {/*
                * Where the order came from, shown only when it is not Shopify.
                * An imported order was priced from an order total rather than a
                * priced basket, and "is this coming from Shopify yet?" is the
                * question this whole screen keeps being asked.
                */}
              {order.source !== "Shopify" && <Badge tone="warn">{order.source}</Badge>}
            </div>

            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {formatDate(order.placedAt)}
              {order.couponCode ? ` · ${order.couponCode}` : ""}
              {showRep && rep ? ` · ${rep.name}` : ""}
              {order.customer?.city ? ` · ${order.customer.city}` : ""}
              {order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
            </p>

            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {order.items.map(item => `${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join(", ")}
            </p>

            {order.commission.reason && (
              <p className="mt-1 text-xs text-[var(--muted)]">{order.commission.reason}</p>
            )}
            {order.commission.wholeOrderFallback && order.commission.amount > 0 && (
              <p className="mt-1 flex items-center gap-1 text-xs text-[var(--warn-ink)]">
                <AlertTriangle size={12} />
                Shopify reported no per-line discount for this coupon, so the whole order was used as the base.
              </p>
            )}
          </div>

          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold">{formatRupees(order.commission.amount)}</p>
            <p className="text-xs text-[var(--muted)]">
              {order.commission.rate}% of {formatRupees(order.commission.base)}
            </p>
            {order.commission.status === "Maturing" && order.commission.maturesAt && (
              <p className="text-xs text-[var(--muted)]">clears {formatDate(order.commission.maturesAt)}</p>
            )}
            {mayOverride && (
              <button onClick={() => setEditing(order)}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline">
                <SlidersHorizontal size={12} />Correct
              </button>
            )}
          </div>
        </div>;
      })}
    </Card>

    {editing && <OverrideDelivery order={editing} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); onChanged?.(); }} />}
  </>;
}

/**
 * Setting a delivery state by hand.
 *
 * The escape hatch for when the courier's feed is wrong or unreadable — a
 * partial delivery settled with the customer, a status Shiprocket has not taught
 * us to read. It decides whether an order pays, so it asks for a reason and
 * leaves a line in the audit trail.
 */
function OverrideDelivery({ order, onClose, onSaved }: {
  order: SalesOrderRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState<DeliveryState | "">(order.delivery.override ?? "");
  const [reason, setReason] = useState(order.delivery.overrideReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/sales/orders/${order._id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ override: state || null, overrideReason: reason || undefined })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not correct this order");
      onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not correct this order");
    } finally { setBusy(false); }
  }

  return <Modal title={`Correct ${order.name}`}
    description={`Shiprocket reports "${order.shipment?.status ?? "nothing yet"}" — read here as ${order.delivery.reported}`}
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} onClick={save}>Save correction</Button>
    </div>}>

    <div className="space-y-4">
      <Field label="What actually happened" hint="Leave it on the courier's own answer to clear a correction.">
        <select className="select" value={state} onChange={event => setState(event.target.value as DeliveryState | "")}>
          <option value="">Use the courier&rsquo;s answer ({order.delivery.reported})</option>
          {DELIVERY_STATES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>

      <Field label="Why" hint="Recorded against the order, with your name and the date.">
        <textarea className="textarea" rows={2} value={reason} onChange={event => setReason(event.target.value)}
          placeholder="Customer confirmed the kit arrived; Shiprocket never updated the status." />
      </Field>

      {order.commission.status === "Paid" || order.commission.status === "In payout" ? (
        <Notice tone="warning">
          This commission has already been {order.commission.status === "Paid" ? "paid" : "put on a payout run"}, so the
          figure will not change. If the correction voids it, the order is flagged for reversal and the money is recovered
          by agreement — an approved run is never rewritten underneath.
        </Notice>
      ) : null}

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
