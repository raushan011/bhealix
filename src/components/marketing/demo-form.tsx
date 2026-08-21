"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { DEMO_INTERESTS, TEAM_SIZES } from "@/lib/demo-leads";

/**
 * The form behind "Book a demo".
 *
 * Short on purpose: a company's name, a person, two ways to reach them, and
 * what they want to see. Everything else is learned on the call. The ticks are
 * the pitch's own pillars, so the request arrives already telling the desk
 * which half of the product to open first.
 */
export function DemoForm() {
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  function toggle(interest: string) {
    setInterests(current => current.includes(interest) ? current.filter(value => value !== interest) : [...current, interest]);
  }

  async function submit(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/demo/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"), company: data.get("company"), email: data.get("email"), phone: data.get("phone"),
          role: data.get("role"), teamSize: data.get("teamSize"), message: data.get("message"), website: data.get("website"),
          interests
        })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "That could not be sent");
      setDone(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That could not be sent");
    } finally { setBusy(false); }
  }

  if (done) {
    return <div className="card fade-in px-6 py-12 text-center">
      <CheckCircle2 size={32} className="mx-auto text-[var(--ok-ink)]" />
      <h2 className="mt-4 text-xl">Thank you — we have it.</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
        Somebody from the team will call or write within one working day to find a time that suits you.
      </p>
      <Link href="/" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)] hover:underline">
        <ArrowLeft size={14} />Back to the site
      </Link>
    </div>;
  }

  return <form action={submit} className="card space-y-5 p-5 sm:p-7">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Your name">
        <input name="name" className="input" required minLength={2} maxLength={80} autoComplete="name" placeholder="Priya Sharma" />
      </Field>
      <Field label="Company">
        <input name="company" className="input" required minLength={2} maxLength={120} autoComplete="organization" placeholder="Sharma Dermacare Pvt. Ltd." />
      </Field>
      <Field label="Work email">
        <input name="email" type="email" className="input" required maxLength={120} autoComplete="email" placeholder="priya@company.com" />
      </Field>
      <Field label="Phone or WhatsApp">
        <input name="phone" type="tel" className="input" required minLength={6} maxLength={20} autoComplete="tel" placeholder="+91 98999 43298" />
      </Field>
      <Field label="Your role" hint="Optional.">
        <input name="role" className="input" maxLength={80} autoComplete="organization-title" placeholder="Founder, Head of Sales, Operations…" />
      </Field>
      <Field label="Team size" hint="People who would use it.">
        <select name="teamSize" className="select" defaultValue="">
          <option value="">Prefer not to say</option>
          {TEAM_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
        </select>
      </Field>
    </div>

    <fieldset>
      <legend className="mb-2 block text-[13px] font-medium text-[var(--ink-2)]">What would you like to see? <span className="text-[var(--muted)]">Tick any.</span></legend>
      <div className="flex flex-wrap gap-2">
        {DEMO_INTERESTS.map(interest => {
          const on = interests.includes(interest);
          return <button key={interest} type="button" onClick={() => toggle(interest)} aria-pressed={on}
            className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${
              on ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}>
            {interest}
          </button>;
        })}
      </div>
    </fieldset>

    <Field label="Anything we should know before we call?" hint="The tools you use today, what is not working, a deadline — whatever helps.">
      <textarea name="message" className="textarea" rows={4} maxLength={2000} />
    </Field>

    {/* The honeypot: hidden from people, irresistible to scripts. */}
    <div className="hidden" aria-hidden>
      <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    </div>

    {error && <Notice tone="error">{error}</Notice>}

    <Button type="submit" busy={busy} className="w-full sm:w-auto sm:min-w-[220px]">{busy ? "Sending…" : "Request a walkthrough"}</Button>
    <p className="text-xs text-[var(--muted)]">We use these details only to arrange your demo. No newsletters, no sharing.</p>
  </form>;
}
