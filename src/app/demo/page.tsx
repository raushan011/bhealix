import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { Appearance } from "@/components/ui/appearance";
import { DemoForm } from "@/components/marketing/demo-form";

export const metadata: Metadata = {
  title: "Book a demo — BHEALIX CRM",
  description: "Thirty minutes, your city, your numbers: see the field force, the online store and the back office running in one system."
};

const PROMISES = [
  "Your city on the discovery map, a route planned around real call hours",
  "An order shipped with live courier prices and a commission cleared on delivery",
  "A GST invoice and a payslip raised from the same data",
  "Honest answers on what it does not do yet — and what we can build"
];

/** The page behind "Book a demo": a short form, and what the half hour buys. */
export default function DemoPage() {
  return <div className="min-h-[100dvh] bg-[var(--bg)]">
    <header className="border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <Link href="/" aria-label="BHEALIX home"><Brand subtitle="Field, online & back office" /></Link>
        <div className="flex items-center gap-2">
          <Appearance />
          <Link href="/" className="tap inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink-2)] hover:text-[var(--brand)]">
            <ArrowLeft size={14} />Back
          </Link>
        </div>
      </div>
    </header>

    <main className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
      <div className="page-enter">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand)]">Book a demo</p>
        <h1 className="mt-2 text-balance text-[30px] leading-[1.15] sm:text-[38px]">Thirty minutes. Your numbers, not ours.</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">
          Tell us a little about your company and we will set up a walkthrough built around how you actually sell —
          on the road, online, or both.
        </p>
        <ul className="mt-6 space-y-2.5">
          {PROMISES.map(line => (
            <li key={line} className="flex gap-2.5 text-sm text-[var(--ink-2)]">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />{line}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs text-[var(--muted)]">Already a customer? <Link href="/login" className="font-semibold text-[var(--brand)] hover:underline">Sign in</Link></p>
      </div>
      <DemoForm />
    </main>
  </div>;
}
