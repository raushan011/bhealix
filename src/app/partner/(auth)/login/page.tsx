"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Brand, BrandMark } from "@/components/ui/brand";
import { Button, Field, Notice } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Where an affiliate signs in. Deliberately a different door from `/login`: the
 * staff sign-in leads to a panel no affiliate may enter, and one form that
 * silently sends two kinds of person to two different applications is a form
 * that will eventually send somebody to the wrong one.
 */
function PartnerLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  /** Set when a guard turned somebody out mid-session, so the empty form is explained. */
  const ended = params.get("ended") === "1";

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingOver, setHandingOver] = useState(false);

  /*
   * Clears the dead cookie a guard could not clear itself.
   *
   * When the portal turns somebody out mid-session it can only redirect — a page
   * render may not write a cookie (see `requirePartner`). So the token is still
   * sitting there, signed and valid-looking, and middleware would bounce them
   * back to a portal that refuses them. This is where it actually goes.
   */
  useEffect(() => {
    if (ended) void fetch("/api/partner/logout", { method: "POST" });
  }, [ended]);

  async function signIn(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/partner/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: data.get("identifier"), password: data.get("password") })
      });
      const json = await response.json() as { error?: string; data?: { redirectTo: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not sign in");

      setHandingOver(true);
      router.replace(next ?? json.data?.redirectTo ?? "/partner");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not sign in");
      setBusy(false);
    }
  }

  if (handingOver) {
    return <main className="fade-in grid min-h-[100dvh] place-items-center px-5">
      <div className="text-center">
        <BrandMark size={44} />
        <p className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-[var(--ink-2)]">
          <Loader2 size={16} className="animate-spin" />Signing you in…
        </p>
      </div>
    </main>;
  }

  return <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
    <ThemeToggle className="fixed right-3 top-3" />
    <div className="page-enter w-full max-w-[380px]">
      <Brand subtitle="Sales partners" />
      <h1 className="mt-9 text-2xl">Partner sign in</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Your coupon codes, the orders they brought in, and what you have earned.</p>

      {ended && <div className="mt-5"><Notice tone="warning">You were signed out. Sign in again to carry on.</Notice></div>}

      <form action={signIn} className="mt-7 space-y-4">
        <Field label="Email or your code" hint="Your code is the word at the front of your coupons — PRIYA, for instance.">
          <input name="identifier" autoComplete="username" required autoFocus className="input" placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <PasswordInput name="password" autoComplete="current-password" required placeholder="••••••••" />
        </Field>
        {error && <p role="alert" className="wrap-break-word rounded-[10px] bg-[var(--danger-bg)] px-3 py-2.5 text-sm font-medium text-[var(--danger-ink)]">{error}</p>}
        <Button type="submit" busy={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--muted)]">
        Not signed up yet? <Link href="/partner/register" className="font-semibold text-[var(--brand)] hover:underline">Apply to sell with us</Link>
      </p>
      <p className="mt-3 text-center text-xs text-[var(--muted)]">
        Forgotten your password? Ask the company to reset it.
      </p>
      <p className="mt-6 text-center text-xs text-[var(--muted)]">
        Company staff sign in <Link href="/login" className="underline hover:text-[var(--ink-2)]">here</Link>.
      </p>
    </div>
  </main>;
}

export default function PartnerLoginPage() {
  return <Suspense><PartnerLoginForm /></Suspense>;
}
