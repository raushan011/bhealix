"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Brand, BrandMark } from "@/components/ui/brand";
import { Button, Field, Notice } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { normaliseCode } from "@/lib/sales/coupons";
import { passwordProblem, repCodeProblem, suggestRepCode } from "@/lib/sales/partners";

/**
 * Applying to sell on commission.
 *
 * Validated here with the very functions the server validates with, so a rep
 * code that will be refused is refused before the round trip rather than after
 * it. The server checks again regardless — this is for the person filling the
 * form in, not for the database.
 *
 * The one thing this screen must not do is imply that filling it in is joining.
 * It is an application: nothing is granted until somebody at the company has
 * looked at it, and the panel at the bottom says so before the button rather
 * than after it.
 */
export default function PartnerRegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  /** Left empty until they type over it, so the suggestion follows the name. */
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingOver, setHandingOver] = useState(false);

  const chosenCode = codeTouched ? normaliseCode(code) : suggestRepCode(name);
  const codeFault = chosenCode ? repCodeProblem(chosenCode) : null;
  const passwordFault = password ? passwordProblem(password) : null;

  async function apply(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/partner/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          code: chosenCode,
          password: data.get("password")
        })
      });
      const json = await response.json() as { error?: string; data?: { redirectTo?: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not send your application");

      setHandingOver(true);
      router.replace(json.data?.redirectTo ?? "/partner");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not send your application");
      setBusy(false);
    }
  }

  if (handingOver) {
    return <main className="fade-in grid min-h-[100dvh] place-items-center px-5">
      <div className="text-center">
        <BrandMark size={44} />
        <p className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-[var(--ink-2)]">
          <Loader2 size={16} className="animate-spin" />Sending your application…
        </p>
      </div>
    </main>;
  }

  return <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
    <ThemeToggle className="fixed right-3 top-3" />
    <div className="page-enter w-full max-w-[420px]">
      <Brand subtitle="Sales partners" />
      <h1 className="mt-9 text-2xl">Sell with Bhealix</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Get your own discount code, share it with your customers, and earn a share of every order it brings in.
      </p>

      <form action={apply} className="mt-7 space-y-4">
        <Field label="Your name">
          <input name="name" required autoFocus autoComplete="name" className="input" placeholder="Priya Sharma"
            value={name} onChange={event => setName(event.target.value)} />
        </Field>

        <Field label="Email" hint="You will sign in with this.">
          <input name="email" type="email" required autoComplete="email" className="input" placeholder="you@example.com" />
        </Field>

        <Field label="Phone" hint="How the company reaches you about a payment.">
          <input name="phone" type="tel" required autoComplete="tel" className="input" placeholder="98765 43210" />
        </Field>

        <Field label="Choose your code"
          hint="This goes at the front of every coupon you get, so keep it short and easy to say out loud.">
          <input name="code" required className="input uppercase" placeholder="PRIYA" autoCapitalize="characters" autoComplete="off"
            value={chosenCode}
            onChange={event => { setCodeTouched(true); setCode(event.target.value); }} />
        </Field>
        {codeFault && <p className="-mt-2 text-xs text-[var(--danger-ink)]">{codeFault}</p>}

        <Field label="Password">
          <PasswordInput name="password" required autoComplete="new-password" placeholder="At least 8 characters"
            value={password} onChange={event => setPassword(event.target.value)} />
        </Field>
        {passwordFault && <p className="-mt-2 text-xs text-[var(--danger-ink)]">{passwordFault}</p>}

        {/*
          * Said before the button, not after it. Somebody who expects a coupon
          * to appear the moment they press Apply and instead finds a waiting
          * screen concludes something broke.
          */}
        <div className="flex gap-2.5 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[var(--muted)]" />
          <p className="text-xs text-[var(--ink-2)]">
            Somebody at the company checks every application. You can sign in straight away to see where yours has got
            to — you will be able to create your coupon code once it has been approved.
          </p>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <Button type="submit" busy={busy} disabled={Boolean(codeFault || passwordFault)} className="w-full">
          {busy ? "Sending…" : "Apply to join"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--muted)]">
        Already applied? <Link href="/partner/login" className="font-semibold text-[var(--brand)] hover:underline">Sign in</Link>
      </p>
    </div>
  </main>;
}
