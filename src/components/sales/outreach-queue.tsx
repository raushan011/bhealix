"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, MapPin, MessageSquare, Pause, PhoneOff, Play, Send, SkipForward, Zap
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import { MessageTemplates } from "@/components/sales/message-templates";
import {
  AUTOPILOT_DELAY_KEY, AUTOPILOT_DELAYS, WHATSAPP_APP_KEY, WHATSAPP_APPS, buildQueue,
  clampAutopilotDelay, whatsappAndroidUrl, whatsappSendUrl, whatsappWebUrl,
  type QueueEntry, type TemplateRecord, type WhatsAppApp
} from "@/lib/sales/outreach";
import type { SalesLeadRecord } from "@/lib/sales/types";

/** How many leads one sitting pulls. The API's own ceiling per page. */
const BATCH = 100;

/**
 * Where a half-worked queue waits while WhatsApp is in front.
 *
 * Opening WhatsApp puts this browser in the background, and a phone under
 * memory pressure discards a backgrounded tab without ceremony — the tab is
 * still listed, but coming back to it re-runs the page from scratch. React
 * state does not survive that, so somebody who sent forty messages returns to
 * an empty setup form and reasonably concludes the thing has lost their place.
 *
 * Session storage rather than local: a queue is one sitting's work, and finding
 * last Tuesday's half-finished batch waiting silently would be worse than being
 * asked to start it again.
 */
const RESUME_KEY = "bhealix.outreach.queue";

type Entry = QueueEntry & { lead: SalesLeadRecord };

/**
 * Working through a list on WhatsApp, one tap each.
 *
 * Built for a phone held in one hand, because that is where it will be used —
 * the person doing this is not at a desk, and the whole value proposition is
 * that it beats typing the same message two hundred times on the same phone.
 * Hence one lead on screen at a time rather than a table with a column of
 * buttons: a list of forty send links is a list you lose your place in, and
 * losing your place here means messaging a parlour twice.
 *
 * The tap opens WhatsApp with the message already written. What happens next is
 * out of this application's hands and always will be — see the `contacted`
 * route for why the mark is written optimistically, and why Back exists.
 */
export function OutreachQueue({ mayEdit }: { mayEdit: boolean }) {
  const [templates, setTemplates] = useState<TemplateRecord[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [filters, setFilters] = useState({ type: "", city: "", freshOnly: true });
  const [types, setTypes] = useState<string[]>([]);
  const [matches, setMatches] = useState<number | null>(null);
  const [counting, setCounting] = useState(true);

  const [queue, setQueue] = useState<Entry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState("");

  /**
   * Whether WhatsApp here is an installed app or a website.
   *
   * Read in an effect rather than during render because the server has no user
   * agent to read, and a value that differs between the server's HTML and the
   * browser's first paint is a hydration mismatch. Defaulting to desktop is the
   * safe way round: `wa.me` works on a phone too, it is merely the worse of the
   * two, whereas `whatsapp://` on a desktop browser does nothing at all.
   */
  const [onPhone, setOnPhone] = useState(false);
  /** Only Android can be told *which* WhatsApp to open — see WHATSAPP_APPS. */
  const [onAndroid, setOnAndroid] = useState(false);
  /**
   * Which WhatsApp this device sends with. A device preference rather than an
   * account one — it is about what is installed on *this* phone — so it lives
   * in local storage and survives sign-outs.
   */
  const [whatsappApp, setWhatsappApp] = useState<WhatsAppApp>("default");
  useEffect(() => {
    setOnPhone(/android|iphone|ipad|ipod/i.test(navigator.userAgent));
    setOnAndroid(/android/i.test(navigator.userAgent));
    try {
      const saved = localStorage.getItem(WHATSAPP_APP_KEY);
      if (WHATSAPP_APPS.some(candidate => candidate.value === saved)) setWhatsappApp(saved as WhatsAppApp);
    } catch { /* storage refused — the default carries the day */ }
  }, []);

  const chooseWhatsappApp = (value: WhatsAppApp) => {
    setWhatsappApp(value);
    try { localStorage.setItem(WHATSAPP_APP_KEY, value); } catch { /* remembered for this visit only */ }
  };

  /*
   * Autopilot: the queue opens each chat itself and moves on by itself, so the
   * only thing a person does is press Send inside WhatsApp. That last press is
   * deliberately not automated — no web page can reach into another site's
   * compose box, and the robots that fake it with browser extensions are
   * exactly what gets a number banned. What *can* be automated is everything
   * around the press, which is where all the clicking back and forth lived.
   *
   * On a desk: each chat opens in one reused WhatsApp Web tab, and the next
   * follows after a chosen number of seconds. On a phone: the next chat opens
   * by itself the moment the rep swipes back from WhatsApp.
   */
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [autoRunning, setAutoRunning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [autoDelay, setAutoDelay] = useState<number>(AUTOPILOT_DELAYS.fallback);
  /** Which lead's chat autopilot has already opened, so a re-render never opens it twice. */
  const openedFor = useRef<string | null>(null);
  /**
   * The one WhatsApp Web window, held onto.
   *
   * The first open happens on the Start click and is allowed everywhere; the
   * ones after that come from a timer, which popup blockers refuse. But a
   * window already open can be *navigated* without anybody's permission — so
   * the handle is kept, and every later chat is a navigation of the same
   * window rather than a new open. Closing it mid-batch pauses the run with a
   * Resume button, whose click is the user gesture the reopen needs.
   */
  const waWindow = useRef<Window | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(AUTOPILOT_DELAY_KEY));
      if (saved) setAutoDelay(clampAutopilotDelay(saved));
    } catch { /* the default pace will do */ }
  }, []);

  const chooseDelay = (value: number) => {
    const clamped = clampAutopilotDelay(value);
    setAutoDelay(clamped);
    try { localStorage.setItem(AUTOPILOT_DELAY_KEY, String(clamped)); } catch { /* kept for this visit */ }
  };

  /** Nothing may be written to storage until what was there has been read. */
  const restored = useRef(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(RESUME_KEY);
      if (saved) {
        const state = JSON.parse(saved) as
          { queue: Entry[]; index: number; sent: string[]; templateId: string };
        if (state.queue?.length) {
          setQueue(state.queue);
          setIndex(state.index ?? 0);
          setSent(new Set(state.sent ?? []));
          if (state.templateId) setTemplateId(state.templateId);
        }
      }
    } catch {
      // A half-written or outdated entry is not worth failing the screen over.
      // Losing the resume point costs a restart; throwing here costs the tab.
    }
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      if (queue) {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify({ queue, index, sent: [...sent], templateId }));
      } else {
        sessionStorage.removeItem(RESUME_KEY);
      }
    } catch {
      // Private browsing and a full quota both land here. The queue still works
      // for as long as the tab survives, which is the common case anyway.
    }
  }, [queue, index, sent, templateId]);

  const loadTemplates = useCallback(async () => {
    const response = await fetch("/api/sales/templates");
    const json = await response.json() as { data?: { items: TemplateRecord[] } };
    const items = json.data?.items ?? [];
    setTemplates(items);
    setTemplateId(current => current || items[0]?._id || "");
  }, []);

  /** The search the Start button is about to run, asked for a count only. */
  const search = useCallback((limit: number) => {
    const params = new URLSearchParams({ limit: String(limit), sort: "outreach" });
    if (filters.type) params.set("type", filters.type);
    if (filters.city) params.set("city", filters.city);
    if (filters.freshOnly) params.set("contacted", "never");
    return fetch(`/api/sales/leads?${params}`);
  }, [filters]);

  const count = useCallback(async () => {
    setCounting(true);
    const response = await search(1);
    const json = await response.json() as { data?: { total: number; types: string[] } };
    setMatches(json.data?.total ?? 0);
    setTypes(json.data?.types ?? []);
    setCounting(false);
  }, [search]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { count(); }, [count]);

  const template = templates?.find(row => row._id === templateId);

  async function start() {
    if (!template) return;
    setError("");
    const response = await search(BATCH);
    const json = await response.json() as { data?: { items: SalesLeadRecord[] } };
    const leads = json.data?.items ?? [];
    if (!leads.length) { setError("Nothing matches those filters any more."); return; }

    setQueue(buildQueue(leads, template.body) as Entry[]);
    setIndex(0);
    setSent(new Set());
    openedFor.current = null;
    setAutoRunning(mode === "auto");
  }

  /**
   * Records the send and moves on.
   *
   * Deliberately not awaited before advancing. The anchor beside this is
   * already handing the browser to WhatsApp, and blocking the next card on a
   * round trip would leave somebody returning from the app to a spinner. A
   * failure surfaces as a notice and the lead stays in tomorrow's queue, which
   * is the harmless direction to be wrong in.
   */
  function recordContact(entry: Entry) {
    setSent(current => new Set(current).add(entry.lead._id));

    fetch(`/api/sales/leads/${entry.lead._id}/contacted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: entry.message, templateId })
    }).then(async response => {
      if (!response.ok) {
        const json = await response.json() as { error?: string };
        setError(json.error ?? `${entry.lead.name} could not be marked as messaged.`);
      }
    }).catch(() => setError(`${entry.lead.name} could not be marked as messaged.`));
  }

  function markSent(entry: Entry) {
    recordContact(entry);
    setIndex(current => current + 1);
  }

  /**
   * Hands the message over, and leaves this page showing the next lead.
   *
   * On a phone the app scheme is assigned to `location` rather than opened in a
   * tab, and the difference is the entire bug it fixes: `target="_blank"` put
   * WhatsApp behind a *second tab*, so coming back landed on that tab's wa.me
   * interstitial while the queue — correctly advanced — sat invisible in the
   * first one. Assigning a scheme the browser cannot navigate to leaves the
   * document alone, so returning is a swipe back onto a page already showing
   * the next number.
   *
   * Returning still has to be done by hand. WhatsApp is a separate application
   * and there is no callback, no redirect and no web API that brings somebody
   * back automatically; anything claiming to is fighting the OS. What can be
   * fixed is what they find when they do come back, which is this.
   */
  function send(entry: Entry) {
    markSent(entry);

    // On Android the chosen app is named in the URL itself; everywhere else
    // the plain scheme is the only option there is.
    const app = whatsappAndroidUrl(entry.lead.phone, entry.message, onAndroid ? whatsappApp : "default");
    if (onPhone && app) window.location.href = app;
    else if (entry.url) window.open(entry.url, "_blank", "noopener,noreferrer");
  }

  /**
   * The autopilot's step: open the current chat, once, and set up the advance.
   *
   * `openedFor` is the whole safety of this loop — every re-render lands here
   * again, and the ref is what makes "open lead 12" idempotent. A dead number
   * is skipped without ceremony; it stays unmessaged on the list, exactly as
   * the manual skip leaves it.
   */
  useEffect(() => {
    if (!autoRunning || !queue) return;
    const entry = queue[index];
    if (!entry) { setAutoRunning(false); return; }
    if (!entry.url) { setIndex(current => current + 1); return; }
    if (openedFor.current === entry.lead._id) return;
    openedFor.current = entry.lead._id;

    if (onPhone) {
      // Recorded before the hand-off — the page is about to lose the screen.
      // The advance happens when the rep swipes back: the listener below.
      recordContact(entry);
      const app = whatsappAndroidUrl(entry.lead.phone, entry.message, onAndroid ? whatsappApp : "default");
      if (app) window.location.href = app;
    } else {
      const url = whatsappWebUrl(entry.lead.phone, entry.message) ?? entry.url;
      let win = waWindow.current;
      if (win && !win.closed) {
        // Navigation of the window we already hold — never blocked.
        win.location.href = url;
      } else {
        win = window.open(url, "bhealix-whatsapp");
      }
      if (!win) {
        // The browser refused the window and nothing was sent — undo the
        // claim on this lead and wait for the click that Resume is.
        openedFor.current = null;
        setAutoRunning(false);
        setCountdown(0);
        setError("The browser blocked the WhatsApp window. Press Resume — that click is the permission it wants.");
        return;
      }
      waWindow.current = win;
      recordContact(entry);
      setCountdown(autoDelay);
    }
    // recordContact is stable enough for this effect's purpose; listing it
    // would re-run the step on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunning, queue, index, onPhone, onAndroid, whatsappApp, autoDelay]);

  /** The desk-side clock: one tick a second, advance at zero. */
  useEffect(() => {
    if (!autoRunning || onPhone || countdown <= 0) return;
    const timer = setTimeout(() => {
      if (countdown === 1) setIndex(current => current + 1);
      setCountdown(current => current - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [autoRunning, onPhone, countdown]);

  /** The phone-side advance: coming back from WhatsApp is the signal to continue. */
  useEffect(() => {
    if (!autoRunning || !onPhone || !queue) return;
    const entry = queue[index];
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      if (entry && openedFor.current === entry.lead._id) {
        // A beat before the next chat, so the return does not feel like a trap.
        setTimeout(() => setIndex(current => current + 1), 800);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [autoRunning, onPhone, queue, index]);

  const pauseAuto = () => { setAutoRunning(false); setCountdown(0); };
  const resumeAuto = () => {
    // The chat on screen was already opened before the pause — resuming
    // re-opening it would message the same shop twice, so resume moves on.
    if (queue && openedFor.current === queue[index]?.lead._id) setIndex(current => current + 1);
    setAutoRunning(true);
  };

  /**
   * Editing what this one lead gets, without touching the saved template.
   *
   * The link is rebuilt from the number rather than patched, so a reworded
   * message and the URL that carries it cannot drift apart.
   */
  function reword(text: string) {
    setQueue(current => current && current.map((entry, at) =>
      at === index
        ? { ...entry, message: text, url: whatsappSendUrl(entry.lead.phone, text) }
        : entry
    ));
  }

  /** The "which WhatsApp" picker — shown only where the choice can be honoured. */
  const appPicker = onAndroid && (
    <Field label="Send with" hint="A phone with both apps opens the personal one unless told otherwise. Set it once — this phone remembers.">
      <select className="select" value={whatsappApp}
        onChange={event => chooseWhatsappApp(event.target.value as WhatsAppApp)}>
        {WHATSAPP_APPS.map(candidate => (
          <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
        ))}
      </select>
    </Field>
  );

  /*
   * The queue is checked before the loading guard below, not after.
   *
   * A batch restored from storage needs none of what that guard waits for —
   * not the template list, not the match count — and making it wait shows a
   * spinner to somebody who has just swiped back from WhatsApp expecting the
   * next number. The wait is the setup form's alone.
   */

  // ------------------------------------------------------------- the queue itself

  if (queue) {
    const entry = queue[index];

    if (!entry) return <div className="space-y-5">
      <Card className="p-8 text-center">
        <CheckCircle2 size={36} className="mx-auto text-[var(--ok-ink)]" />
        <h2 className="mt-3 text-lg font-semibold">Batch done</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {sent.size} of {queue.length} messaged. {queue.length - sent.size > 0
            ? `${queue.length - sent.size} skipped — they stay in the list.`
            : "Every one in this batch was messaged."}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => { setQueue(null); count(); }}>Back to setup</Button>
          <Button tone="secondary" onClick={() => { start(); count(); }}>Load the next {BATCH}</Button>
        </div>
      </Card>
    </div>;

    const done = index;
    const lead = entry.lead;

    return <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}

      <div>
        <div className="flex items-center justify-between text-sm">
          <button onClick={() => { pauseAuto(); setQueue(null); count(); }}
            className="tap inline-flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--ink)]">
            <ArrowLeft size={15} />Setup
          </button>
          <span className="font-semibold text-[var(--muted)]">{done + 1} of {queue.length}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--brand-soft)]">
          <div className="h-full rounded-full bg-[var(--brand)] transition-all"
            style={{ width: `${(done / queue.length) * 100}%` }} />
        </div>
      </div>

      {mode === "auto" && (
        <Card className="flex items-center justify-between gap-3 p-3.5">
          <p className="flex min-w-0 items-center gap-2 text-sm">
            <Zap size={15} className="shrink-0 text-[var(--brand)]" />
            {autoRunning
              ? <span className="min-w-0 truncate font-semibold">
                  {onPhone ? "Autopilot on — press Send, then swipe back" : countdown > 0 ? `Next chat in ${countdown}s` : "Opening chat…"}
                </span>
              : <span className="text-[var(--muted)]">Autopilot paused</span>}
          </p>
          <Button tone="secondary" className="shrink-0 px-3 text-xs" onClick={autoRunning ? pauseAuto : resumeAuto}>
            {autoRunning ? <><Pause size={13} />Pause</> : <><Play size={13} />Resume</>}
          </Button>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="wrap-break-word text-base font-semibold">{lead.name}</p>
          <Badge tone="brand">{lead.type}</Badge>
          {(lead.contactCount ?? 0) > 0 && (
            <Badge tone="warn">Messaged {lead.contactCount}× before</Badge>
          )}
        </div>

        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--ink-2)]">
          <MapPin size={12} className="mt-0.5 shrink-0 text-[var(--muted)]" />
          <span className="wrap-break-word">{lead.address || lead.city || "Address not published"}</span>
        </p>

        <div className="mt-4">
          <Field label="Message" hint="Change it for this one lead if you want — the saved message stays as it is.">
            <textarea className="textarea" rows={6} value={entry.message}
              onChange={event => reword(event.target.value)} />
          </Field>
        </div>

        {entry.url ? (<>
          <button type="button" onClick={() => send(entry)} disabled={autoRunning}
            className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50">
            <Send size={17} />{autoRunning ? "Autopilot is sending…" : "Send on WhatsApp"}
          </button>
          {/*
            * The escape hatch for a phone with no WhatsApp installed, where the
            * scheme resolves to nothing and the tap appears to do nothing at
            * all. Small, underneath, and the ordinary path never needs it.
            */}
          {onPhone && (
            <a href={entry.url} target="_blank" rel="noreferrer"
              className="mt-2 block text-center text-xs text-[var(--muted)] underline">
              Nothing opened? Try the browser link
            </a>
          )}
        </>) : (
          <Notice tone="warning">
            <span className="flex items-center gap-1.5">
              <PhoneOff size={14} />
              {lead.phone
                ? `“${lead.phone}” is not a number WhatsApp can open. Correct it on the saved list.`
                : "Google published no number for this one."}
            </span>
          </Notice>
        )}

        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => setIndex(current => Math.max(0, current - 1))} disabled={index === 0 || autoRunning}
            className="tap inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-40">
            <ArrowLeft size={15} />Back
          </button>
          <button onClick={() => setIndex(current => current + 1)}
            className="tap inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
            Skip<SkipForward size={15} />
          </button>
        </div>
      </Card>

      <p className="text-center text-xs text-[var(--muted)]">
        WhatsApp opens with the message ready. Press send, then come back here —
        this page will already be on the next one.
      </p>

      {/* Mid-batch is exactly when the wrong app opening gets noticed. */}
      {onAndroid && (
        <Card className="p-3.5">{appPicker}</Card>
      )}
    </div>;
  }

  // ------------------------------------------------------------------- setup

  if (!templates || counting && matches === null) return <Spinner label="Loading…" />;

  return <div className="space-y-5">
    {error && <Notice tone="error">{error}</Notice>}

    <Card className="space-y-4 p-5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Message to send">
            <select className="select" value={templateId} onChange={event => setTemplateId(event.target.value)}>
              {!templates.length && <option value="">No messages written yet</option>}
              {templates.map(row => (
                <option key={row._id} value={row._id}>
                  {row.name}{row.audience ? ` · ${row.audience}` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button tone="secondary" className="shrink-0" onClick={() => setManaging(true)}>
          <MessageSquare size={15} />Messages
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <select className="select" value={filters.type}
            onChange={event => setFilters(current => ({ ...current, type: event.target.value }))}>
            <option value="">Every type</option>
            {types.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="City" hint="Leave blank for everywhere.">
          <input className="input" value={filters.city} placeholder="Ghaziabad"
            onChange={event => setFilters(current => ({ ...current, city: event.target.value }))} />
        </Field>
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={filters.freshOnly}
          onChange={event => setFilters(current => ({ ...current, freshOnly: event.target.checked }))} />
        <span>
          Only those never messaged
          <span className="block text-xs text-[var(--muted)]">
            Turn this off to message a list again — the same shop twice in a week is what gets a number blocked.
          </span>
        </span>
      </label>

      {appPicker}

      <div className="space-y-2">
        <p className="text-[13px] font-medium text-[var(--ink-2)]">How it sends</p>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="radio" name="outreach-mode" className="mt-0.5" checked={mode === "manual"}
            onChange={() => setMode("manual")} />
          <span>
            One at a time
            <span className="block text-xs text-[var(--muted)]">You press the button for each chat, and come back when you choose.</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="radio" name="outreach-mode" className="mt-0.5" checked={mode === "auto"}
            onChange={() => setMode("auto")} />
          <span>
            Autopilot
            <span className="block text-xs text-[var(--muted)]">
              {onPhone
                ? "Each chat opens by itself the moment you swipe back from WhatsApp — you only press Send there."
                : "Chats open one after another in a single WhatsApp Web tab — you only press Enter there. Sign in to WhatsApp Web in this browser first."}
            </span>
          </span>
        </label>
        {mode === "auto" && !onPhone && (
          <Field label="Seconds between chats"
            hint="Long enough to read and press Enter. The pause button is there mid-batch when a chat needs more.">
            <input type="number" className="input" min={AUTOPILOT_DELAYS.min} max={AUTOPILOT_DELAYS.max}
              value={autoDelay} onChange={event => chooseDelay(Number(event.target.value))} />
          </Field>
        )}
        {mode === "auto" && (
          <p className="text-xs text-[var(--muted)]">
            The final press of Send stays yours on purpose — a robot pressing it inside WhatsApp is what gets a number
            banned, and this number is the one on the packaging.
          </p>
        )}
      </div>
    </Card>

    {template && (
      <Card className="p-5">
        <p className="text-xs font-semibold text-[var(--muted)]">How it will read</p>
        <div className="mt-2 rounded-[10px] bg-[var(--brand-soft)] px-3.5 py-3 text-sm whitespace-pre-wrap wrap-break-word">
          {buildQueue([{ _id: "sample", name: "Glow Beauty Studio", area: "Indirapuram", city: "Ghaziabad", type: "Beauty parlour" }], template.body)[0].message}
        </div>
      </Card>
    )}

    {!templates.length ? (
      <EmptyState icon={MessageSquare} title="Write a message first"
        description="You need something to send before there is a list to send it to."
        action={mayEdit ? <Button onClick={() => setManaging(true)}>Write one</Button> : undefined} />
    ) : (
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-[var(--muted)]">
          {counting ? "Counting…" : <><span className="font-semibold text-[var(--ink)]">{matches}</span> leads match</>}
        </p>
        <Button className="w-full sm:w-auto" disabled={!matches || !template || counting} onClick={start}>
          {mode === "auto" ? <><Zap size={16} />Start autopilot</> : <><Send size={16} />Start sending</>}
        </Button>
        {(matches ?? 0) > BATCH && (
          <p className="text-xs text-[var(--muted)]">{BATCH} at a time — load the next batch when this one is done.</p>
        )}
      </div>
    )}

    {managing && <MessageTemplates templates={templates} mayEdit={mayEdit}
      onChanged={loadTemplates} onClose={() => { setManaging(false); loadTemplates(); }} />}
  </div>;
}
