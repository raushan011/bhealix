import Link from "next/link";
import { Bricolage_Grotesque, IBM_Plex_Mono } from "next/font/google";
import {
  ArrowRight, ArrowUpRight, Building2, Database, FileText, Layers, Lock, Plug, ShieldCheck, Smartphone, Users, Wrench, Zap
} from "lucide-react";
import { BrandMark } from "@/components/ui/brand";
import { HeroConsole } from "./hero-console";
import { Reveal } from "./reveal";
import styles from "./landing.module.css";

/**
 * The front door for somebody who has never signed in.
 *
 * The panels sell the product to the people already using it; this page sells
 * it to everybody else — and it has a second job: a company judging whether
 * to trust us with their systems reads our own front door as the first piece
 * of evidence. So it is built as one committed piece of design rather than a
 * restyled panel: its own ink-and-paper palette, its own type, a hero that is
 * the product narrating a day instead of a screenshot, and a timeline that
 * walks that day through the product. Static and server-rendered, with two
 * small client islands: the ticking console and the scroll reveal.
 */

const display = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", variable: "--font-display", axes: ["opsz", "wdth"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-mono" });

const DEMO = "/demo";

const MARQUEE = [
  "Doctor discovery", "Route plans by call hours", "GPS-verified visits", "Day view", "GST billing", "Part-payments with proof",
  "Inventory ledger", "Samples", "Attendance that fills itself", "Statutory payroll", "Shopify sync", "Partner portal",
  "Self-serve coupons", "Live courier rates", "Batch booking", "Pay-on-delivery commissions", "Retarget", "WhatsApp outreach",
  "Invoice vault", "Custom integrations"
];

type Stop = { time: string; label: string; title: string; body: React.ReactNode; frag: React.ReactNode };

const DAY: Stop[] = [
  {
    time: "06:40", label: "the route", title: "The day plans itself around the doctors' hours.",
    body: <>Each doctor&rsquo;s call window is recorded once. Routes are ordered <b>by call time first, distance second</b>, with a planned arrival per stop — and a doctor who cannot be reached in their window is flagged, never quietly misplaced.</>,
    frag: <div className={styles.frag}>
      <div className={styles.fragHead}><span>Rahul · Tuesday</span><span className={`${styles.chip} ${styles.chipInfo}`}>9 stops</span></div>
      <div className={styles.row}><div>Dr. Meera Krishnan<small>Indiranagar · sees reps 10–1</small></div><span className={styles.mono}>10:05</span></div>
      <div className={styles.row}><div>Dr. Anil Rao<small>Koramangala · sees reps 11–2</small></div><span className={styles.mono}>11:20</span></div>
      <div className={styles.row}><div>Dr. S. Iyer<small>Jayanagar · sees reps 2–4 PM</small></div><span className={styles.mono}>14:10</span></div>
      <div className={styles.row}><div>Dr. Farah Khan<small>HSR · Thursdays only</small></div><span className={`${styles.chip} ${styles.chipWarn}`}>Conflict → Thu</span></div>
    </div>
  },
  {
    time: "10:12", label: "the visit", title: "Verified, not reported.",
    body: <>Check-in captures the phone&rsquo;s position. The rep logs the outcome, samples with quantities and a photo of the prescription pad. <b>The samples leave the stock ledger the same second.</b> Photos clear themselves after thirty days; the record stays for good.</>,
    frag: <div className={styles.frag}>
      <div className={styles.fragHead}><span>Visit · Dr. Krishnan</span><span className={`${styles.chip} ${styles.chipOk}`}>GPS verified</span></div>
      <div className={styles.row}><div>Samples given<small>Sun Screen SPF 50g ×1 · Pigmentation kit ×1</small></div><span className={styles.mono}>−2</span></div>
      <div className={styles.row}><div>Interest<small>Will prescribe the kit</small></div><span className={`${styles.chip} ${styles.chipOk}`}>High</span></div>
      <div className={styles.row}><div>Time in clinic<small>Checked in 10:12 · closed 10:31</small></div><span className={styles.mono}>19 min</span></div>
    </div>
  },
  {
    time: "12:58", label: "the order", title: "The order attributes itself.",
    body: <>A Shopify order lands by webhook in seconds, carrying Priya&rsquo;s coupon. The commission base is printed on the row — <b>30% of ₹1,499</b> — so it can be checked, not trusted. It stays <b>pending</b> until the parcel is delivered.</>,
    frag: <div className={styles.frag}>
      <div className={styles.fragHead}><span>Order #1804</span><span className={`${styles.chip} ${styles.chipInfo}`}>Prepaid</span></div>
      <div className={styles.row}><div>Coupon PRIYA30<small>Priya Nair · Kochi</small></div><span className={styles.mono}>₹1,499</span></div>
      <div className={styles.row}><div>Commission<small>30% of ₹1,499 · pending delivery</small></div><span className={styles.mono}>₹450</span></div>
    </div>
  },
  {
    time: "13:03", label: "the parcel", title: "Every courier's live price. One tap.",
    body: <>Open the order and every courier serving that PIN appears with its price and promised days, cheapest first. <b>Book forty in a batch</b>; each success reports its AWB, each failure its exact reason. Thirty labels come back as one PDF.</>,
    frag: <div className={styles.frag}>
      <div className={styles.fragHead}><span>Ships to 682016 · 0.4 kg</span><span className={`${styles.chip} ${styles.chipOk}`}>4 couriers</span></div>
      <div className={styles.row}><div>Delhivery Surface<small>3 days</small></div><span className={styles.mono}>₹62</span></div>
      <div className={styles.row}><div>Xpressbees<small>3 days · +₹9</small></div><span className={styles.mono}>₹71</span></div>
      <div className={styles.row}><div>Blue Dart Air<small>1 day · +₹86</small></div><span className={styles.mono}>₹148</span></div>
    </div>
  },
  {
    time: "17:45", label: "the payout", title: "Commission clears on delivery — not before.",
    body: <>Delivered, so ₹450 moves from pending to <b>payable</b>, grouped under Priya with her UPI ID beside the total. A parcel that comes back after payment is <b>flagged for a human</b>, never deducted in silence. Priya sees the same line in her portal.</>,
    frag: <div className={styles.frag}>
      <div className={styles.fragHead}><span>Priya Nair · owed</span><span className={`${styles.chip} ${styles.chipOk}`}>Delivered</span></div>
      <div className={styles.row}><div>In transit<small>2 parcels</small></div><span className={styles.mono}>₹840</span></div>
      <div className={styles.row}><div>Payable now<small>#1804 · #1791</small></div><span className={styles.big}>₹900</span></div>
      <div className={styles.row}><div>Paid this month<small>UTR 4471…</small></div><span className={styles.mono}>₹3,150</span></div>
    </div>
  },
  {
    time: "19:30", label: "the call back", title: "The March customer gets a call.",
    body: <>Every order the shop has ever taken is a customer to ring — two years pulled in on day one. One tap opens the call with the remark box ready and presets for how calls actually end. <b>&ldquo;Do not call&rdquo; is respected on every later pass.</b></>,
    frag: <div className={styles.frag}>
      <div className={styles.fragHead}><span>Retarget · 789 orders</span><span className={`${styles.chip} ${styles.chipWarn}`}>36 follow-ups due</span></div>
      <div className={styles.row}><div>Adarsh Singh · 45 orders<small>&ldquo;Happy with the kit — will reorder next month.&rdquo;</small></div><span className={`${styles.chip} ${styles.chipOk}`}>Interested</span></div>
      <div className={styles.row}><div>Suroj Mallick · 2 orders<small>Last order 15 Aug · in transit</small></div><span className={styles.chip}>Not called</span></div>
    </div>
  },
  {
    time: "31 Aug", label: "month end", title: "The books close themselves.",
    body: <>Payroll reads the attendance the visits already wrote: PF, ESI and professional tax computed, joiners pro-rated, <b>nobody left out quietly</b>. The GST invoices carry their HSN summaries. The vault has every vendor bill filed — and names the one that is missing.</>,
    frag: <div className={styles.frag}>
      <div className={styles.fragHead}><span>August · payroll</span><span className={`${styles.chip} ${styles.chipInfo}`}>Prepared</span></div>
      <div className={styles.row}><div>On the rolls<small>38 people · 2 joiners pro-rated</small></div><span className={styles.mono}>38</span></div>
      <div className={styles.row}><div>Could not pay<small>No salary set — listed, not skipped</small></div><span className={styles.mono}>1</span></div>
      <div style={{ marginTop: 10 }}><div className={styles.bar}><i style={{ width: "72%" }} /></div><small style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--muted)" }}>Vault: 5 of 7 sources filed · Meta ads, Razorpay outstanding</small></div>
    </div>
  }
];

const INDEX: { group: string; items: [string, string][] }[] = [
  { group: "Field & clinic", items: [
    ["Find doctors", "Google Maps discovery across 13 specialities, up to 100 km, hundreds of results"],
    ["Doctors & call hours", "The directory, with when each doctor actually sees reps"],
    ["Route plans", "Ordered by call time, then distance, with arrival per stop"],
    ["Visits", "GPS check-in, samples, outcome, photos that expire"],
    ["Day view", "Time in clinics vs travel; kilometres planned vs walked"],
    ["Reports", "Completion, samples, outcomes, interest — per rep, any range"]
  ] },
  { group: "Online & affiliates", items: [
    ["Leads & WhatsApp", "Prospect any business on Google Maps; a human-paced send queue or Meta API autopilot"],
    ["Partners & coupons", "Self-registration, self-minted codes live in Shopify, suspend kills the code"],
    ["Orders", "Attributed, with the commission base shown on every row"],
    ["Process orders", "Live courier rates per PIN, batch booking, merged labels, live tracking"],
    ["Payouts", "Pending → payable on delivery → paid and frozen; reversals flagged"],
    ["Retarget", "Every customer the shop has ever had, as a calling list"]
  ] },
  { group: "Back office", items: [
    ["Billing", "GST or bill of supply, HSN summary, part-payments with proof, PDF from one link"],
    ["Inventory & samples", "Append-only ledger; one stock pool for bills and samples"],
    ["HR desk", "Attendance that fills itself, leave with enforced balances, holidays"],
    ["Payroll", "Dated salary revisions, statutory deductions, prepared → approved → paid"],
    ["Invoice vault", "Every vendor bill by month, gaps named, one ZIP for the CA"],
    ["Panel access", "Per-person grants that take effect on the next click"]
  ] }
];

export function LandingPage() {
  return <div className={`${styles.page} ${display.variable} ${mono.variable}`} style={{ fontFamily: "var(--font-display), ui-sans-serif, system-ui, sans-serif" }}>
    <Reveal root={styles.page} />

    <header className={styles.header}>
      <div className={`${styles.wrap} ${styles.headerRow}`}>
        <Link href="/" className={styles.brand} aria-label="BHEALIX home">
          <BrandMark size={30} />
          <span><b>BHEALIX</b><small>One day. One system.</small></span>
        </Link>
        <nav className={styles.nav} aria-label="Page sections">
          <a href="#day">The day</a>
          <a href="#doors">Who uses it</a>
          <a href="#modules">Modules</a>
          <a href="#custom">Custom work</a>
          <a href="#trust">Trust</a>
        </nav>
        <div className={styles.headerActions}>
          <Link href="/login" className={`${styles.btn} ${styles.btnGhost} ${styles.hideSm}`}>Sign in</Link>
          <a href={DEMO} className={`${styles.btn} ${styles.btnAmber}`}>Book a demo</a>
        </div>
      </div>
    </header>

    <main>
      {/* ---------------------------------------------------------------- hero */}
      <section className={styles.hero}>
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div>
            <p className={`${styles.pulse} ${styles.mono}`}><span className={styles.dot} aria-hidden />Field force · online store · back office</p>
            <h1 className={styles.h1}>One day.<br />One <em>system.</em></h1>
            <p className={styles.lede}>
              BHEALIX runs the reps on the road, the orders coming in online, and the books at the end of the
              month — as one piece of software, on one database, where a visit, an order, an invoice and a payslip
              are the same data and nothing is typed twice.
            </p>
            <div className={styles.heroCtas}>
              <a href={DEMO} className={`${styles.btn} ${styles.btnAmber}`}>Book a 30-minute walkthrough<ArrowRight size={16} /></a>
              <a href="#day" className={`${styles.btn} ${styles.btnGhost}`}>Watch the day</a>
            </div>
            <dl className={styles.stats}>
              <div className={styles.stat}><dd><b>3</b><span>portals — desk, field app, partner</span></dd></div>
              <div className={styles.stat}><dd><b>40</b><span>parcels booked in one batch</span></dd></div>
              <div className={styles.stat}><dd><b>2 yrs</b><span>of orders pulled in on day one</span></dd></div>
            </dl>
          </div>
          <HeroConsole />
        </div>
      </section>

      <div className={styles.marquee} aria-hidden>
        <div className={styles.marqueeTrack}>
          {[...MARQUEE, ...MARQUEE].map((item, index) => <span key={index}>{item}</span>)}
        </div>
      </div>

      {/* ----------------------------------------------------------------- day */}
      <section id="day" className={styles.section}>
        <div className={styles.wrap}>
          <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
            <p className={styles.eyebrow} style={{ color: "var(--amber-deep)" }}>A Tuesday, start to finish</p>
            <h2 className={styles.h2}>What one day looks like when nothing is retyped.</h2>
            <p className={styles.sub}>Seven moments from an ordinary working day — each one handled by the same system, each one leaving the ledgers still balanced. Every figure below is how the product actually behaves.</p>
          </div>
          <div className={styles.day}>
            {DAY.map(stop => (
              <article key={stop.time} className={`${styles.stop} ${styles.reveal}`} data-reveal>
                <div className={styles.stopTime}>{stop.time}<small>{stop.label}</small></div>
                <div><h3>{stop.title}</h3><p>{stop.body}</p></div>
                {stop.frag}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- doors */}
      <section id="doors" className={`${styles.section}`} style={{ background: "var(--paper-2)" }}>
        <div className={styles.wrap}>
          <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
            <p className={styles.eyebrow} style={{ color: "var(--amber-deep)" }}>One database, three doors</p>
            <h2 className={styles.h2}>Every person gets the screen their day needs.</h2>
            <p className={styles.sub}>The desk, the road and the partners each get their own door. Behind all three is one system, so nobody retypes what somebody else already knows.</p>
          </div>
          <div className={`${styles.doors} ${styles.reveal}`} data-reveal>
            <div className={styles.door}>
              <span className={styles.eyebrow}><Building2 size={14} style={{ verticalAlign: "-2px", marginRight: 8 }} />Desk panel</span>
              <h3>The people who run it</h3>
              <p>Doctor CRM, Sales CRM and a control room, switchable from one sign-in.</p>
              <ul><li>Dashboards, approvals, billing, payroll, inventory</li><li>Per-person panel grants, live on the next click</li><li>Every report, every export</li></ul>
            </div>
            <div className={styles.door}>
              <span className={styles.eyebrow}><Smartphone size={14} style={{ verticalAlign: "-2px", marginRight: 8 }} />Field app</span>
              <h3>The people on the road</h3>
              <p>Installs on the phone like an app. Five tabs built for one hand in a corridor.</p>
              <ul><li>Today&rsquo;s route, one-tap call and directions</li><li>GPS check-in, samples, photos</li><li>Bills, payments with proof, leave, payslips</li></ul>
            </div>
            <div className={styles.door}>
              <span className={styles.eyebrow}><Users size={14} style={{ verticalAlign: "-2px", marginRight: 8 }} />Partner portal</span>
              <h3>The people who sell for you</h3>
              <p>Affiliates apply, get approved, and mint their own coupon codes — live in Shopify instantly.</p>
              <ul><li>Every order as a timeline, placed to paid</li><li>Owed, split honestly five ways</li><li>Their own payment details and password</li></ul>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- modules */}
      <section id="modules" className={styles.section}>
        <div className={styles.wrap}>
          <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
            <p className={styles.eyebrow} style={{ color: "var(--amber-deep)" }}>The index</p>
            <h2 className={styles.h2}>Eighteen modules. One sign-in.</h2>
            <p className={styles.sub}>Everything below ships today. Each line is a screen somebody uses every working day, not a roadmap item.</p>
          </div>
          <div className={styles.index}>
            {INDEX.map(group => (
              <div key={group.group} className={`${styles.group} ${styles.reveal}`} data-reveal>
                <h3>{group.group}</h3>
                <dl>{group.items.map(([name, what]) => <div key={name}><dt>{name}</dt><dd>{what}</dd></div>)}</dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- custom */}
      <section id="custom" className={`${styles.section} ${styles.onInk}`}>
        <div className={`${styles.wrap} ${styles.custom}`}>
          <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
            <p className={styles.eyebrow} style={{ color: "var(--amber)" }}>Custom development &amp; integrations</p>
            <h2 className={styles.h2}>Don&rsquo;t see your tool or your workflow? We build it.</h2>
            <p className={styles.sub}>BHEALIX is a product that comes with the team that built it. If your business runs on something we don&rsquo;t connect to yet, or works a way the screens don&rsquo;t, that is a conversation — scoped and quoted before any work starts.</p>
            <div style={{ marginTop: 8 }}>
              <a href={DEMO} className={`${styles.btn} ${styles.btnAmber}`}>Tell us what you need<ArrowUpRight size={16} /></a>
            </div>
          </div>
          <div className={`${styles.customList} ${styles.reveal}`} data-reveal>
            <div className={styles.customItem}><Wrench size={20} /><div><b>Custom modules</b><p>New screens, reports and approval flows built to your process — your fields, your statuses, your documents — inside the same sign-in and permissions.</p></div></div>
            <div className={styles.customItem}><Plug size={20} /><div><b>Custom integrations</b><p>Other storefronts, couriers and payment gateways; accounting and ERP systems; SMS, email and telephony providers; webhooks and exports for anything downstream.</p></div></div>
            <div className={styles.customItem}><Layers size={20} /><div><b>Your brand, your deployment</b><p>Your name, logo and colours throughout, including the apps your reps and partners install. A dedicated deployment and database per company.</p></div></div>
            <div className={styles.customItem}><Database size={20} /><div><b>Migration &amp; rollout</b><p>Doctor, customer, product and partner lists brought in from Excel or your old system; order history pulled in; training for the desk, the field and the partners.</p></div></div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- integrations */}
      <section id="integrations" className={styles.section}>
        <div className={styles.wrap}>
          <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
            <p className={styles.eyebrow} style={{ color: "var(--amber-deep)" }}>Connected</p>
            <h2 className={styles.h2}>Plugged into the tools Indian commerce runs on.</h2>
            <p className={styles.sub}>Connected from a settings screen, not by a developer. Credentials are encrypted at rest and never shown again.</p>
          </div>
          <div className={`${styles.logos} ${styles.reveal}`} data-reveal>
            {[["Shopify", "orders, customers, discount codes"], ["Shiprocket", "rates, AWBs, labels, tracking"], ["WhatsApp Business", "Meta Cloud API"], ["Google Maps", "discovery, routes, geocoding"], ["Razorpay", "fee statements"], ["Meta Ads", "spend statements"], ["Excel / CSV", "in and out"], ["PDF", "invoices, labels, payslips"]].map(([name, what]) => (
              <span key={name} className={styles.logo}>{name}<small>{what}</small></span>
            ))}
          </div>
          <div className={`${styles.layers} ${styles.reveal}`} data-reveal>
            <div className={styles.layer}><b>Seconds</b><p><strong>Webhooks.</strong> An order placed, paid or cancelled in Shopify is here before the customer has closed the tab.</p></div>
            <div className={styles.layer}><b>Nightly</b><p><strong>The 1:30 AM pass.</strong> Re-reads anything a webhook lost, asks every courier about every moving parcel, re-prices every unpaid commission.</p></div>
            <div className={styles.layer}><b>On demand</b><p><strong>Full resync.</strong> One tap reaches over the whole history. The last twenty passes are listed on screen, so the automation can be seen working.</p></div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- trust */}
      <section id="trust" className={styles.section} style={{ background: "var(--paper-2)" }}>
        <div className={styles.wrap}>
          <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
            <p className={styles.eyebrow} style={{ color: "var(--amber-deep)" }}>Built like the books depend on it</p>
            <h2 className={styles.h2}>Because they do.</h2>
            <p className={styles.sub}>Permissions decided on the server on every request. Money computed on the server every time. Anything that is evidence stores a snapshot, not a reference.</p>
          </div>
          <div className={styles.trust}>
            {[
              [ShieldCheck, "Server-side permissions, every request", "Five staff roles plus per-person panel grants, re-read from the database on every click. A suspension takes effect on the next tap, not the next sign-in."],
              [Lock, "Secrets encrypted, personal data minimised", "Shopify, Shiprocket and Meta credentials encrypted at rest and never sent to a browser. Only the last four digits of Aadhaar are ever stored."],
              [FileText, "Documents that cannot drift", "A payslip carries the employment record as it stood on issue day. A paid commission is frozen. Every ledger is append-only; balances are derived."],
              [Zap, "Fast where your people are", "Hosted in Mumbai beside the database. Installable on any phone. Honest offline behaviour — a shared device never serves one rep's data to the next."]
            ].map(([Icon, title, body]) => {
              const I = Icon as React.ComponentType<{ size?: number }>;
              return <div key={title as string} className={`${styles.trustItem} ${styles.reveal}`} data-reveal><I size={24} /><div><b>{title as string}</b><p>{body as string}</p></div></div>;
            })}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- cta */}
      <section className={styles.cta}>
        <div className={`${styles.wrap} ${styles.ctaInner}`}>
          <p className={styles.eyebrow} style={{ color: "var(--amber)" }}>Thirty minutes, your numbers</p>
          <h2>See your own Tuesday run through it.</h2>
          <p className={styles.sub}>Your city on the discovery map. A route planned around real call hours. An order shipped, a commission cleared, an invoice and a payslip raised — live, on your data, not a slide about ours.</p>
          <div className={styles.ctaRow}>
            <a href={DEMO} className={`${styles.btn} ${styles.btnAmber}`}>Book a walkthrough<ArrowRight size={16} /></a>
            <Link href="/partner/register" className={`${styles.btn} ${styles.btnGhost}`}>Apply as a sales partner</Link>
          </div>
        </div>
      </section>
    </main>

    <footer className={styles.footer}>
      <div className={`${styles.wrap} ${styles.footerRow}`}>
        <span className={styles.mono}>BHEALIX CRM · field, online &amp; back office</span>
        <nav aria-label="Footer">
          <Link href="/login">Staff sign in</Link>
          <Link href="/partner/login">Partner sign in</Link>
          <Link href="/partner/register">Become a partner</Link>
          <a href={DEMO}>Book a demo</a>
        </nav>
      </div>
    </footer>
  </div>;
}
