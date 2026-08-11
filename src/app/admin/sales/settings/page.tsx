"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Link2 as LinkIcon, Plug, RefreshCw, XCircle } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import { AutomationPanel } from "@/components/sales/automation-panel";
import { COMMISSION_BASES } from "@/lib/sales/constants";
import { weekdayName } from "@/lib/sales/payouts";
import type { CommissionRule } from "@/lib/sales/commission";
import type { SalesSettingsRecord } from "@/lib/sales/types";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Credentials, commission rates and the payout cadence.
 *
 * The two secrets are never sent back to the browser — the form shows whether
 * one is stored and lets it be replaced, which is everything anybody needs and
 * rather less than a page that echoes a Shopify admin token into its own HTML.
 *
 * Saving a changed rate re-prices every commission no run has claimed, and says
 * how many. A rate change that only took effect on the next sync is the kind of
 * thing discovered a week later, in somebody's payout.
 */
export default function SalesSettingsPage() {
  const [settings, setSettings] = useState<SalesSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string } | "busy" | undefined>>({});

  const [connecting, setConnecting] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("/api/sales/shopify/callback");
  /** The App URL Shopify must be told about — the same origin the redirect is built from. */
  const [appOrigin, setAppOrigin] = useState("");

  const [shopifyDomain, setShopifyDomain] = useState("");
  const [shopifyApiVersion, setShopifyApiVersion] = useState("2026-07");
  const [shopifyClientId, setShopifyClientId] = useState("");
  const [shopifyClientSecret, setShopifyClientSecret] = useState("");
  const [shopifyAccessToken, setShopifyAccessToken] = useState("");
  const [shiprocketEmail, setShiprocketEmail] = useState("");
  const [shiprocketPassword, setShiprocketPassword] = useState("");
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [holdDays, setHoldDays] = useState(7);
  const [payoutWeekday, setPayoutWeekday] = useState(1);
  const [backfillDays, setBackfillDays] = useState(90);

  const load = useCallback(async () => {
    const response = await fetch("/api/sales/settings");
    const json = await response.json() as { data?: SalesSettingsRecord };
    const data = json.data;
    if (data) {
      setSettings(data);
      if (data.callbackUrl) setCallbackUrl(data.callbackUrl);
      // Trailing slash stripped: Shopify compares hosts, but a stored App URL
      // that does not match what is pasted here invites a needless second look.
      if (data.appUrl) setAppOrigin(data.appUrl.replace(/\/+$/, ""));
      setShopifyDomain(data.shopifyDomain ?? "");
      setShopifyApiVersion(data.shopifyApiVersion ?? "2026-07");
      setShopifyClientId(data.shopifyClientId ?? "");
      setShiprocketEmail(data.shiprocketEmail ?? "");
      setRules(data.rules ?? []);
      setHoldDays(data.holdDays ?? 7);
      setPayoutWeekday(data.payoutWeekday ?? 1);
      setBackfillDays(data.backfillDays ?? 90);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /**
   * The OAuth round trip comes back as a redirect carrying its outcome, so it is
   * read off the address bar rather than from a fetch. `window` rather than
   * `useSearchParams`, which would put a Suspense boundary around the whole
   * screen for one message.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("shopify");
    if (!outcome) return;

    setNotice({
      tone: outcome === "connected" ? "success" : "error",
      text: params.get("message") ?? (outcome === "connected" ? "Connected to Shopify." : "Could not connect to Shopify.")
    });
    // Cleared so a refresh does not replay a message about something that has
    // already been dealt with.
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  /**
   * Saves first, because the handshake reads the client id and secret from the
   * database — the same trap "Test connection" fell into.
   */
  async function connectShopify() {
    setConnecting(true); setNotice(null);
    const saved = await persist();
    if (!saved.ok) {
      setConnecting(false);
      setNotice({ tone: "error", text: saved.message });
      return;
    }
    // A full navigation, not a fetch: the browser has to travel to Shopify for
    // the merchant to approve the scopes.
    window.location.href = "/api/sales/shopify/install";
  }

  /**
   * Writes the form, and reports what happened rather than announcing it —
   * "Save & test" needs to save without two notices fighting over one line.
   */
  async function persist(): Promise<{ ok: true; recalculated: number } | { ok: false; message: string }> {
    try {
      const response = await fetch("/api/sales/settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopifyDomain, shopifyApiVersion, shopifyClientId,
          shopifyClientSecret: shopifyClientSecret || undefined,
          shopifyAccessToken: shopifyAccessToken || undefined,
          shiprocketEmail,
          shiprocketPassword: shiprocketPassword || undefined,
          rules, holdDays, payoutWeekday, backfillDays
        })
      });
      const json = await response.json() as { error?: string; data?: { recalculated: number } };
      if (!response.ok) throw new Error(json.error ?? "Could not save these settings");

      // The secrets are stored now; clearing the inputs is what makes a blank
      // field mean "leave what is held alone" on the next save.
      setShopifyAccessToken(""); setShopifyClientSecret(""); setShiprocketPassword("");
      return { ok: true, recalculated: json.data?.recalculated ?? 0 };
    } catch (problem) {
      return { ok: false, message: problem instanceof Error ? problem.message : "Could not save these settings" };
    }
  }

  async function save() {
    setBusy(true); setNotice(null);
    const result = await persist();
    setBusy(false);

    if (!result.ok) return setNotice({ tone: "error", text: result.message });
    setNotice({
      tone: "success",
      text: result.recalculated
        ? `Saved. ${result.recalculated} commission${result.recalculated === 1 ? " was" : "s were"} re-priced — anything already on a payout run keeps the figure that run committed to.`
        : "Saved."
    });
    load();
  }

  /**
   * Saves, then asks.
   *
   * The credentials being tested have to be the ones that will be stored.
   * Testing what is in the database while the operator is looking at what they
   * have just typed produces exactly one outcome: "add the credentials first",
   * said to somebody who is staring at the credentials they added.
   */
  async function test(service: "shopify" | "shiprocket") {
    setTests(current => ({ ...current, [service]: "busy" }));

    const saved = await persist();
    if (!saved.ok) {
      setTests(current => ({ ...current, [service]: { ok: false, message: saved.message } }));
      return;
    }

    try {
      const response = await fetch("/api/sales/settings/test", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service })
      });
      const json = await response.json() as { error?: string; data?: { ok: boolean; message: string } };
      setTests(current => ({ ...current, [service]: json.data ?? { ok: false, message: json.error ?? "Could not test" } }));
    } catch {
      setTests(current => ({ ...current, [service]: { ok: false, message: "Could not reach the server." } }));
    }
    load();
  }

  const setRule = (index: number, patch: Partial<CommissionRule>) =>
    setRules(current => current.map((rule, at) => at === index ? { ...rule, ...patch } : rule));

  if (loading) return <Spinner label="Loading settings…" />;

  return <div className="space-y-5">
    <PageTitle title="Sales settings" subtitle="Credentials, commission rates and the payout cadence"
      actions={<Button busy={busy} onClick={save}>Save settings</Button>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Shopify</h2>
        <Button tone="secondary" busy={tests.shopify === "busy"} onClick={() => test("shopify")}>
          <Plug size={15} />Save &amp; test
        </Button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Create an app in the <strong>Shopify Dev Dashboard</strong> and give it the Admin API scopes
        <strong> read_orders</strong> and <strong> read_products</strong>. Set the two URLs below on it, release a
        version, then paste its Client ID and secret here and press Connect.
      </p>

      {/*
        * Both URLs, not just the redirect.
        *
        * Shopify refuses the handshake unless the redirect URI and the App URL
        * share a host — "The redirect_uri and application url must have matching
        * hosts". A new app's App URL defaults to https://example.com, so showing
        * only the redirect URL sends people to a refusal from Shopify that names
        * a setting they were never told to fill in.
        */}
      <div className="space-y-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Set both of these on the app</p>
        <CopyRow label="App URL" value={appOrigin} />
        <CopyRow label="Redirect URL" value={callbackUrl} />
        <p className="text-xs text-[var(--muted)]">
          They must share a host, or Shopify refuses the handshake before you ever see the approval screen. Turn
          <strong> embedded</strong> off too — this CRM is its own site, not a panel inside the Shopify admin.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shop address" hint="Your .myshopify.com address, not your storefront domain. Pasting your admin URL works — the handle is read out of it.">
          <input className="input" value={shopifyDomain} placeholder="your-store.myshopify.com"
            onChange={event => setShopifyDomain(event.target.value)} />
        </Field>
        <Field label="API version" hint="Bump this only when Shopify retires the one in use.">
          <input className="input" value={shopifyApiVersion} onChange={event => setShopifyApiVersion(event.target.value)} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client ID">
          <input className="input" value={shopifyClientId} placeholder="32 hex characters"
            onChange={event => setShopifyClientId(event.target.value)} />
        </Field>
        <Field label="Client secret" hint={settings?.shopifyClientSecretSet ? "A secret is stored. Leave blank to keep it." : "From the app's Settings page"}>
          <PasswordInput value={shopifyClientSecret} placeholder={settings?.shopifyClientSecretSet ? "••••••••" : ""}
            onChange={event => setShopifyClientSecret(event.target.value)} />
        </Field>
      </div>

      {/*
        * Shopify will only send an approval back to an https address, so a
        * local server cannot finish the handshake. Better said here than
        * discovered as a refusal on Shopify's own screen, which does not
        * explain itself.
        */}
      {settings && !settings.appUrl && (
        <Notice tone="error">
          NEXT_PUBLIC_APP_URL is not configured, so there is nowhere for Shopify to send the approval back to.
        </Notice>
      )}
      {settings?.appUrl?.startsWith("http://") && (
        <Notice tone="warning">
          Shopify only returns an approval to an <strong>https</strong> address, and this server is
          <code className="mx-1">{settings.appUrl}</code>. Connect from your deployed site instead — the token is stored in
          the database, so a local copy pointed at the same database is connected too.
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button busy={connecting}
          disabled={!shopifyDomain || !(shopifyClientId && (shopifyClientSecret || settings?.shopifyClientSecretSet)) || !settings?.appUrl}
          onClick={connectShopify}>
          <LinkIcon size={15} />{settings?.shopifyTokenSet ? "Reconnect with Shopify" : "Connect with Shopify"}
        </Button>
        {settings?.shopifyTokenSet && (
          <span className="text-sm text-[var(--ok-ink)]">
            Connected{settings.shopifyConnectedAt ? ` on ${new Date(settings.shopifyConnectedAt).toLocaleDateString("en-IN")}` : ""}
            {settings.shopifyScopes ? ` · ${settings.shopifyScopes}` : ""}
          </span>
        )}
      </div>

      {/*
        * Kept for shops still running a legacy custom app. Shopify stopped
        * issuing those on 1 January 2026, so it is folded away rather than
        * shown first — offering it as the main path would send somebody looking
        * for a screen that no longer exists.
        */}
      <details className="text-sm">
        <summary className="cursor-pointer text-[var(--muted)]">I already have an shpat_ token from a legacy custom app</summary>
        <div className="mt-3">
          <Field label="Admin API access token"
            hint={settings?.shopifyTokenSet ? `A token is stored (${settings.shopifyTokenHint}). Leave blank to keep it.` : "Starts with shpat_"}>
            <PasswordInput value={shopifyAccessToken} placeholder={settings?.shopifyTokenSet ? "••••••••" : "shpat_…"}
              onChange={event => setShopifyAccessToken(event.target.value)} />
          </Field>
        </div>
      </details>

      <TestResult result={tests.shopify} />
      <SyncState label="Last order sync" at={settings?.lastOrderSyncAt} error={settings?.lastOrderSyncError} />
    </Card>

    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Shiprocket</h2>
        <Button tone="secondary" busy={tests.shiprocket === "busy"} onClick={() => test("shiprocket")}>
          <Plug size={15} />Save &amp; test
        </Button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Create an API user in Shiprocket (Settings → API → Configure) and use its credentials here — not your own login.
        The bearer token lasts ten days and is refreshed automatically.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="API user email">
          <input className="input" type="email" value={shiprocketEmail} onChange={event => setShiprocketEmail(event.target.value)} />
        </Field>
        <Field label="Password" hint={settings?.shiprocketPasswordSet ? "A password is stored. Leave blank to keep it." : undefined}>
          <PasswordInput value={shiprocketPassword} placeholder={settings?.shiprocketPasswordSet ? "••••••••" : ""}
            onChange={event => setShiprocketPassword(event.target.value)} />
        </Field>
      </div>

      <TestResult result={tests.shiprocket} />
      <SyncState label="Last delivery sync" at={settings?.lastShipmentSyncAt} error={settings?.lastShipmentSyncError} />
    </Card>

    <Card className="space-y-4 p-5">
      <h2 className="text-base font-semibold">Commission rules</h2>
      <p className="text-sm text-[var(--muted)]">
        One rule per coupon suffix. A code ending <strong>30</strong> is paid at the 30 rule&rsquo;s rate, on the money the
        customer actually paid for the lines that coupon discounted.
      </p>

      <div className="space-y-3">
        {rules.map((rule, index) => (
          <div key={index} className="rounded-[10px] border border-[var(--line)] p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Suffix">
                <input className="input" value={rule.suffix} onChange={event => setRule(index, { suffix: event.target.value })} />
              </Field>
              <Field label="Called">
                <input className="input" value={rule.label} onChange={event => setRule(index, { label: event.target.value })} />
              </Field>
              <Field label="Rate %">
                <input className="input" type="number" value={rule.rate}
                  onChange={event => setRule(index, { rate: Number(event.target.value) })} />
              </Field>
              <Field label="Applied to">
                <select className="select" value={rule.base} onChange={event => setRule(index, { base: event.target.value as CommissionRule["base"] })}>
                  {COMMISSION_BASES.map(base => <option key={base} value={base}>{base}</option>)}
                </select>
              </Field>
            </div>

            {rule.base === "Named products" && (
              <Field label="Products" hint="SKUs or exact product titles, one per line.">
                <textarea className="textarea" rows={2} value={rule.products.join("\n")}
                  onChange={event => setRule(index, { products: event.target.value.split("\n").map(value => value.trim()).filter(Boolean) })} />
              </Field>
            )}

            <div className="mt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rule.active} onChange={event => setRule(index, { active: event.target.checked })} />
                In use
              </label>
              <span className="text-xs text-[var(--muted)]">Codes like <strong>NAME{rule.suffix}</strong></span>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => setRules(current => [...current, { suffix: "", label: "", rate: 10, base: "Discounted lines", products: [], active: true }])}
        className="text-sm font-medium text-[var(--brand)] hover:underline">Add a rule</button>
    </Card>

    <Card className="space-y-4 p-5">
      <h2 className="text-base font-semibold">Payouts</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Hold after delivery" hint="Days before a delivered order's commission may be paid.">
          <input className="input" type="number" min={0} max={90} value={holdDays}
            onChange={event => setHoldDays(Number(event.target.value))} />
        </Field>
        <Field label="Payout day" hint="Only a reminder — a run is always prepared by hand.">
          <select className="select" value={payoutWeekday} onChange={event => setPayoutWeekday(Number(event.target.value))}>
            {WEEKDAYS.map(day => <option key={day} value={day}>{weekdayName(day)}</option>)}
          </select>
        </Field>
        <Field label="First sync reaches back" hint="Days, when nothing has been pulled before.">
          <input className="input" type="number" min={1} max={730} value={backfillDays}
            onChange={event => setBackfillDays(Number(event.target.value))} />
        </Field>
      </div>
      <Notice tone="info">
        A delivered order becomes payable {holdDays} days later, which is the window a customer has to send it back.
        Shortening it pays reps sooner and makes a return more likely to land after the money has gone.
      </Notice>
    </Card>

    <AutomationPanel />

    <div className="flex justify-end"><Button busy={busy} onClick={save}>Save settings</Button></div>
  </div>;
}

/**
 * A value to be pasted into somebody else's dashboard, with a button that puts
 * it on the clipboard. Retyping a URL by hand is how a host ends up one
 * character out, and Shopify's refusal for that does not say which character.
 */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return <div className="flex flex-wrap items-center gap-2">
    <span className="w-24 shrink-0 text-xs text-[var(--muted)]">{label}</span>
    <code className="min-w-0 flex-1 wrap-break-word rounded bg-[var(--surface)] px-2 py-1 text-xs">{value || "—"}</code>
    <button
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      disabled={!value}
      className="tap shrink-0 rounded-[8px] px-2 text-xs font-medium text-[var(--brand)] hover:bg-[var(--surface)] disabled:text-[var(--muted)]">
      {copied ? "Copied" : "Copy"}
    </button>
  </div>;
}

function TestResult({ result }: { result: { ok: boolean; message: string } | "busy" | undefined }) {
  if (!result || result === "busy") return null;
  return <p className={`flex items-start gap-1.5 text-sm ${result.ok ? "text-[var(--ok-ink)]" : "text-[var(--danger-ink)]"}`}>
    {result.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
    {result.message}
  </p>;
}

function SyncState({ label, at, error }: { label: string; at?: string; error?: string }) {
  return <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
    <RefreshCw size={12} />
    {label}: {at ? new Date(at).toLocaleString("en-IN") : "never"}
    {error && <Badge tone="danger">{error}</Badge>}
  </p>;
}
