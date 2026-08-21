import Link from "next/link";
import {
  ArrowRight, BadgeCheck, BarChart3, Boxes, Building2, CalendarCheck, Camera, Database, FileText, Landmark,
  Lock, MapPin, MessageCircle, Package, PhoneCall, Plug, Route, ShieldCheck, Smartphone, Store, Truck,
  Users, Wallet, Wrench, Zap
} from "lucide-react";
import { Badge } from "@/components/ui/kit";
import { Brand, BrandMark } from "@/components/ui/brand";
import { Appearance } from "@/components/ui/appearance";

/**
 * The front door for somebody who has never signed in.
 *
 * The panels sell the product to the people already using it; this page sells
 * it to everybody else. It is written for the buyer, not the operator — what
 * the system runs, not how — and it paints with the same tokens as the panels
 * behind it, so the first page a prospect sees and the first screen they are
 * shown in a demo are visibly the same product. Dark mode and the monochrome
 * palette come along for free for the same reason.
 *
 * Server-rendered and static: there is nothing here worth shipping JavaScript
 * for except the appearance switcher, which is its own client island.
 */

/** Every call to action lands on the demo form; its requests surface in the control room's Demo leads. */
const CONTACT = "/demo";

type Icon = React.ComponentType<{ size?: number; className?: string }>;

const TRUST: { icon: Icon; title: string; body: string }[] = [
  { icon: ShieldCheck, title: "Server-side permissions, every request", body: "Five staff roles plus per-person panel grants, re-read from the database on every click — suspending someone takes effect on their next tap, not their next sign-in." },
  { icon: Lock, title: "Secrets encrypted, PII minimised", body: "Shopify, Shiprocket and Meta credentials encrypted at rest and never sent to a browser. Only the last four digits of Aadhaar are ever stored; bank accounts are masked everywhere but the paying screen." },
  { icon: FileText, title: "Documents that can't drift", body: "A payslip carries the employment record as it stood on issue day. A paid commission is frozen. Cancelled invoice numbers stay in the books. Every ledger is append-only." },
  { icon: Zap, title: "Fast where your customers are", body: "Hosted in Mumbai beside the database, installable on any phone, and honest offline behaviour — a shared device never serves one rep's data to the next." }
];

function Section({ id, eyebrow, title, lead, children }: {
  id?: string; eyebrow: string; title: string; lead?: string; children: React.ReactNode;
}) {
  return <section id={id} className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-14 sm:px-8 sm:py-20">
    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand)]">{eyebrow}</p>
    <h2 className="mt-2 max-w-2xl text-balance text-2xl font-semibold sm:text-3xl">{title}</h2>
    {lead && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">{lead}</p>}
    <div className="mt-8 sm:mt-10">{children}</div>
  </section>;
}

function FeatureCard({ icon: Icon, title, points }: {
  icon: React.ComponentType<{ size?: number; className?: string }>; title: string; points: string[];
}) {
  return <div className="card p-5">
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--brand-soft)] text-[var(--brand)]">
      <Icon size={19} />
    </span>
    <h3 className="mt-3.5 text-[15px] font-semibold">{title}</h3>
    <ul className="mt-2 space-y-1.5">
      {points.map(point => (
        <li key={point} className="flex gap-2 text-sm leading-relaxed text-[var(--ink-2)]">
          <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--line-2)]" />
          {point}
        </li>
      ))}
    </ul>
  </div>;
}

/** A believable sliver of the product, drawn with the product's own parts. */
function HeroVignette() {
  return <div className="relative mx-auto w-full max-w-[420px]" aria-hidden>
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Today&rsquo;s route · 8 calls</p>
        <Badge tone="info">On round</Badge>
      </div>
      <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Dr. Meera Krishnan</p>
          <Badge tone="warn">Sees reps 2&ndash;4 PM</Badge>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Skin &amp; Hair Clinic, Indiranagar · 4.8 ★ · planned 2:20 PM</p>
      </div>
      <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Order #1804 · ₹1,499</p>
          <Badge tone="success">Delivered</Badge>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Coupon PRIYA30 · commission 30% of ₹1,499 → <span className="font-semibold text-[var(--ok-ink)]">₹450 payable</span></p>
      </div>
      <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Retarget · Adarsh Singh</p>
          <Badge tone="brand">Interested</Badge>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">&ldquo;Happy with the kit — will reorder next month.&rdquo; · follow up 12 Sep</p>
      </div>
    </div>
    <div className="absolute -bottom-4 -right-2 hidden rounded-full border border-[var(--ok-line)] bg-[var(--ok-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--ok-ink)] shadow-sm sm:block">
      40 parcels booked in one batch
    </div>
  </div>;
}

export function LandingPage() {
  return <div className="min-h-[100dvh] bg-[var(--bg)]">
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--surface-veil)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <Brand subtitle="Field, online & back office" />
        <nav className="hidden items-center gap-6 text-sm font-medium text-[var(--ink-2)] lg:flex" aria-label="Page sections">
          <a href="#panels" className="hover:text-[var(--brand)]">Product</a>
          <a href="#modules" className="hover:text-[var(--brand)]">Modules</a>
          <a href="#integrations" className="hover:text-[var(--brand)]">Integrations</a>
          <a href="#custom" className="hover:text-[var(--brand)]">Custom work</a>
          <a href="#trust" className="hover:text-[var(--brand)]">Security</a>
        </nav>
        <div className="flex items-center gap-2">
          <Appearance />
          <Link href="/login" className="tap hidden items-center rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-4 text-sm font-semibold hover:bg-[var(--surface-2)] sm:inline-flex">
            Sign in
          </Link>
          <a href={CONTACT} className="tap inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] hover:bg-[var(--brand-hover)]">
            Book a demo
          </a>
        </div>
      </div>
    </header>

    <main>
      {/* ------------------------------------------------------------- hero */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-14 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:pb-20">
        <div className="page-enter">
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-2)]">
            <Zap size={13} className="text-[var(--brand)]" />One system for field sales, online sales and the back office
          </p>
          <h1 className="mt-5 text-balance text-[32px] font-semibold leading-[1.12] sm:text-[44px]">
            Run the reps, the store and the books &mdash; without running three systems.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--muted)] sm:text-base">
            BHEALIX CRM plans your field force&rsquo;s day around each clinic&rsquo;s call hours, syncs every Shopify
            order and pays affiliate commissions only on delivery, rings your whole customer base back for repeat
            sales, and raises the GST invoice and the payslip at the end of it. Built in India, for how business
            is actually done here.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a href={CONTACT} className="inline-flex min-h-[48px] items-center gap-2 rounded-[10px] bg-[var(--brand)] px-6 text-sm font-semibold text-[var(--on-brand)] hover:bg-[var(--brand-hover)]">
              Book a walkthrough<ArrowRight size={16} />
            </a>
            <Link href="/login" className="inline-flex min-h-[48px] items-center rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-6 text-sm font-semibold hover:bg-[var(--surface-2)]">
              Sign in
            </Link>
          </div>
          <dl className="mt-9 grid max-w-xl grid-cols-3 gap-4 border-t border-[var(--line)] pt-6">
            {[
              ["3 portals", "desk, field app, partner"],
              ["40 at once", "parcels booked in a batch"],
              ["2 years", "of orders pulled on day one"]
            ].map(([value, label]) => (
              <div key={value} className="min-w-0">
                <dt className="sr-only">{label}</dt>
                <dd>
                  <p className="text-lg font-semibold tabular-nums sm:text-xl">{value}</p>
                  <p className="mt-0.5 text-xs leading-snug text-[var(--muted)]">{label}</p>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <HeroVignette />
      </section>

      {/* ------------------------------------------------- the three doors */}
      <div className="border-y border-[var(--line)] bg-[var(--surface)]">
        <Section id="panels" eyebrow="One platform, three doors"
          title="Every person gets the screen their day actually needs"
          lead="A desk panel for the people who run the business, a phone-first app for the people on the road, and a portal for the partners who sell for you — one database underneath, so nobody retypes anything.">
          <div className="grid gap-4 sm:grid-cols-3">
            <FeatureCard icon={Building2} title="The desk panel" points={[
              "Doctor CRM, Sales CRM and a super-admin control room, switchable from one sign-in",
              "Dashboards, approvals, billing, payroll, inventory and every report",
              "Per-person panel grants — withdrawing access takes effect on the next click"
            ]} />
            <FeatureCard icon={Smartphone} title="The field app" points={[
              "Installable phone app (PWA) with the day's route in visiting order",
              "One-tap call, one-tap directions, GPS check-in and call photos",
              "Reps raise bills, collect payments and apply for leave from the same phone"
            ]} />
            <FeatureCard icon={Users} title="The partner portal" points={[
              "Affiliates apply, get approved, and mint their own coupon codes — live in Shopify the same second",
              "Every order tracked placed → dispatched → delivered → commission → paid",
              "What they're owed, split honestly: in transit, clearing, payable, paid"
            ]} />
          </div>
        </Section>
      </div>

      {/* ----------------------------------------------------- the modules */}
      <Section id="modules" eyebrow="Field &amp; clinic operations"
        title="From finding the doctor to knowing how the day really went"
        lead="Built for teams that sell into clinics: discovery, routing around each doctor's visiting hours, GPS-verified calls, and a day view that reports the day as it was actually walked.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={MapPin} title="Doctor discovery" points={[
            "Search Google Maps for 13 specialities — dermatologists to trichologists — up to 100 km out",
            "Wide sweeps return hundreds of results, not Google's usual twenty",
            "Save to the directory in bulk; export to Excel and upload the edited sheet back"
          ]} />
          <FeatureCard icon={Route} title="Route plans" points={[
            "Each doctor's own call hours recorded — which days, which times, appointment or not",
            "Routes ordered by call time first, distance second, with a planned arrival per stop",
            "Assign the plan to a rep and their day appears on their phone"
          ]} />
          <FeatureCard icon={Camera} title="Visits, verified" points={[
            "GPS check-in, outcome, products discussed, samples with quantities, order value",
            "Up to eight photos per call — clinic front, prescription pad — auto-deleted after 30 days",
            "Follow-up dates that surface on the right day"
          ]} />
          <FeatureCard icon={BarChart3} title="The day, as it went" points={[
            "Time inside clinics vs travel, average call length, gaps between calls",
            "Distance actually travelled leg by leg, set against what the plan intended",
            "Completion judged on what was attempted — and stale open rounds flagged"
          ]} />
          <FeatureCard icon={CalendarCheck} title="HR that fills itself in" points={[
            "A completed visit marks the rep present; approved leave marks itself; holidays apply to all",
            "Leave with balances enforced at request time — nobody signs off their own",
            "Employment records kept whole: leavers are recorded, never erased"
          ]} />
          <FeatureCard icon={Wallet} title="Statutory payroll" points={[
            "The month builds itself from attendance — PF, ESI and professional tax computed, joiners and leavers pro-rated",
            "Salary as effective-dated revisions, so old payslips never change",
            "HR prepares, the administrator approves and releases — by design"
          ]} />
        </div>
      </Section>

      <div className="border-y border-[var(--line)] bg-[var(--surface)]">
        <Section eyebrow="Online sales &amp; affiliates"
          title="From a stranger's shopfront to a commission paid on delivery"
          lead="The whole online funnel in one place: find leads, message them on WhatsApp, let partners sell on their own coupons, ship with live courier rates, pay commissions only when the parcel lands — then ring every customer back.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard icon={MessageCircle} title="Leads &amp; WhatsApp outreach" points={[
              "Prospect any business type on Google Maps — parlours, salons, chemists — up to 500 at a time",
              "A one-tap send queue with templates and merge fields, or full autopilot via Meta's WhatsApp Business API",
              "Daily caps, delivery receipts and a reply inbox — a reply stops the run for that lead"
            ]} />
            <FeatureCard icon={Store} title="Shopify, attributed" points={[
              "Orders sync by webhook in seconds, with a nightly pass and on-demand resync behind it",
              "Every coupon order attributed to its partner, with the commission base shown, not hidden",
              "Partners mint their own codes — created in Shopify instantly, disabled the moment one is suspended"
            ]} />
            <FeatureCard icon={Truck} title="Shipping desk" points={[
              "Every courier serving that PIN listed with its live price the moment the dialog opens",
              "Book 40 orders in one batch — each success and each failure reported by name",
              "Thirty labels or invoices merged into one printable PDF; live scan-by-scan tracking"
            ]} />
            <FeatureCard icon={Package} title="Commissions &amp; payouts" points={[
              "Pending in transit, payable on delivery, frozen once paid — never recomputed",
              "Payouts grouped by partner with their UPI or account beside the total",
              "Parcels returned after payment are flagged for a human, never deducted silently"
            ]} />
            <FeatureCard icon={PhoneCall} title="Retarget every customer" points={[
              "Every order the shop has ever taken becomes a customer to ring — two years pulled on day one",
              "One-tap call and WhatsApp with the remark box already open, presets for how calls actually end",
              "Repeat buyers recognised across orders; 'Do not call' respected on every later pass"
            ]} />
            <FeatureCard icon={FileText} title="GST billing &amp; collections" points={[
              "Tax invoices with per-line discounts, HSN summaries, CGST/SGST or IGST by place of supply",
              "Part-payments with proof attached — UPI screenshot, cheque photo — and a chase list per bill",
              "Bank details and payment QR printed on every bill; PDF from one link, desk or phone"
            ]} />
          </div>
        </Section>
      </div>

      <Section eyebrow="Back office"
        title="Stock, purchase paper and the books that always add up"
        lead="Append-only ledgers underneath everything: a stock figure, a bill balance or a sample count can never disagree with the events behind it.">
        <div className="grid gap-4 sm:grid-cols-3">
          <FeatureCard icon={Boxes} title="Inventory &amp; samples" points={[
            "One stock pool per product — billed goods and rep samples draw from the same figure",
            "Batches, expiries, reorder alerts, and stocktakes recorded as corrections",
            "A per-rep sample matrix rebuilt from visits, so re-submitting never double-counts"
          ]} />
          <FeatureCard icon={Landmark} title="The invoice vault" points={[
            "Every bill the company receives, filed by month — Shiprocket, Razorpay, Shopify, Meta and the rest",
            "Fetched automatically where the vendor has an API; the gaps named, not hidden",
            "A month's whole bundle as one ZIP for the CA, with a contents sheet of totals"
          ]} />
          <FeatureCard icon={BadgeCheck} title="Approvals with teeth" points={[
            "Payroll: prepared → approved → paid, and a paid month cannot be reopened",
            "Leave, partner applications and commission payouts each pass a named human",
            "An audit trail beside every change — who did what, and when"
          ]} />
        </div>
      </Section>

      {/* -------------------------------------------------------- integrations */}
      <div className="border-y border-[var(--line)] bg-[var(--surface)]">
        <Section id="integrations" eyebrow="Integrations"
          title="Connected to the tools Indian commerce actually runs on"
          lead="Connect once from a settings screen — no developer needed day to day. Credentials are encrypted at rest and never shown again.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Shopify", "orders, customers, discount codes, webhooks"],
              ["Shiprocket", "live courier rates, AWBs, labels, tracking"],
              ["WhatsApp Business", "automated outreach via Meta's Cloud API"],
              ["Google Maps", "doctor & lead discovery, routes, geocoding"],
              ["Razorpay", "gateway fee statements for the vault"],
              ["Meta Ads", "ad spend statements for the vault"],
              ["Excel / CSV", "imports and exports on every list"],
              ["Anything else", "custom integrations built to order — see below"]
            ].map(([name, what]) => (
              <div key={name} className="card px-4 py-3.5">
                <p className="text-sm font-semibold">{name}</p>
                <p className="mt-0.5 text-xs leading-snug text-[var(--muted)]">{what}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Three layers of sync, on purpose: webhooks land in seconds, a nightly pass catches anything they
            missed, and a full resync is one tap when you want the belt checked as well as the braces. The last
            twenty passes are listed on screen, so the automation can be <em>seen</em> working rather than assumed.
          </p>
        </Section>
      </div>

      {/* ------------------------------------------------------- custom work */}
      <Section id="custom" eyebrow="Custom development &amp; integrations"
        title="Don't see your tool or your workflow? We build it."
        lead="BHEALIX is a product, not a template — and it comes with the team that built it. If your business runs on something we don't connect to yet, or works a way the screens don't, that is a conversation, not a dead end.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={Wrench} title="Custom modules" points={[
            "New screens, reports and approval flows built to your process",
            "Your own fields, statuses and documents — not renamed versions of ours",
            "Delivered inside the same system, same sign-in, same permissions"
          ]} />
          <FeatureCard icon={Plug} title="Custom integrations" points={[
            "Other storefronts, couriers, payment gateways and accounting software",
            "SMS, email and telephony providers; ERPs and tally-style ledgers",
            "Webhooks and exports for anything downstream of you"
          ]} />
          <FeatureCard icon={Building2} title="Your brand, your deployment" points={[
            "Your company name, logo and colours throughout — including the apps your reps install",
            "A dedicated deployment and database per company; nothing shared",
            "Hosted where your customers are"
          ]} />
          <FeatureCard icon={Database} title="Migration &amp; rollout" points={[
            "Doctor, customer, product and partner lists brought in from Excel or your old system",
            "Order history pulled in, so day one is not an empty screen",
            "Training for the desk, the field and the partners"
          ]} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a href={CONTACT} className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)] hover:bg-[var(--brand-hover)]">
            Tell us what you need<ArrowRight size={16} />
          </a>
          <p className="text-sm text-[var(--muted)]">Scoped and quoted before any work starts.</p>
        </div>
      </Section>

      {/* ------------------------------------------------------------ trust */}
      <Section id="trust" eyebrow="Security &amp; trust"
        title="Built like the books depend on it — because they do"
        lead="Permissions are decided on the server on every request, money is computed on the server every time, and anything that is evidence stores a snapshot rather than a reference.">
        <div className="grid gap-4 sm:grid-cols-2">
          {TRUST.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card flex gap-4 p-5">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--brand-soft)] text-[var(--brand)]">
                <Icon size={19} />
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ink-2)]">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* -------------------------------------------------------- final CTA */}
      <div className="border-t border-[var(--line)] bg-[var(--brand-soft)]">
        <section className="mx-auto w-full max-w-6xl px-5 py-16 text-center sm:px-8 sm:py-20">
          <BrandMark size={44} />
          <h2 className="mx-auto mt-5 max-w-xl text-balance text-2xl font-semibold sm:text-3xl">
            See your own numbers in it, not a slide about ours
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-[var(--muted)]">
            A walkthrough takes thirty minutes: your city on the discovery map, a route planned around real
            call hours, an order shipped and a commission cleared — live.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a href={CONTACT} className="inline-flex min-h-[48px] items-center gap-2 rounded-[10px] bg-[var(--brand)] px-6 text-sm font-semibold text-[var(--on-brand)] hover:bg-[var(--brand-hover)]">
              Book a walkthrough<ArrowRight size={16} />
            </a>
            <Link href="/partner/register" className="inline-flex min-h-[48px] items-center rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-6 text-sm font-semibold hover:bg-[var(--surface-2)]">
              Apply as a sales partner
            </Link>
          </div>
        </section>
      </div>
    </main>

    <footer className="border-t border-[var(--line)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-4 px-5 py-8 sm:flex-row sm:items-center sm:px-8">
        <Brand />
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--muted)]" aria-label="Footer">
          <Link href="/login" className="hover:text-[var(--brand)]">Staff sign in</Link>
          <Link href="/partner/login" className="hover:text-[var(--brand)]">Partner sign in</Link>
          <Link href="/partner/register" className="hover:text-[var(--brand)]">Become a partner</Link>
          <a href={CONTACT} className="hover:text-[var(--brand)]">Book a demo</a>
        </nav>
      </div>
    </footer>
  </div>;
}
