"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Brand, BrandMark } from "@/components/ui/brand";
import { Button, Field } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import { Appearance } from "@/components/ui/appearance";

/**
 * The form behind `/super-admin`.
 *
 * The same endpoint the ordinary sign-in uses, with `scope: "super"` on it — so
 * an account that is not a super administrator is refused *before* a cookie is
 * set, rather than signed in and bounced afterwards. On success it lands
 * directly on the control panel instead of the chooser.
 */
export function SuperAdminSignIn() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingOver, setHandingOver] = useState(false);

  async function signIn(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: data.get("identifier"),
          password: data.get("password"),
          scope: "super"
        })
      });
      const json = await response.json() as { error?: string; data?: { redirectTo: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not sign in");

      // The panel is server-rendered, so there is a beat between here and the
      // first paint. Cover it deliberately rather than leaving a dead form on
      // screen, and leave `busy` set so nothing can be submitted twice.
      setHandingOver(true);
      router.replace(json.data?.redirectTo ?? "/admin/control");
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
    <Appearance className="fixed right-3 top-3" />
    <div className="page-enter w-full max-w-[380px]">
      <Brand />

      <span className="mt-9 inline-flex items-center gap-1.5 rounded-full border border-[var(--line-2)] bg-[var(--brand-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]">
        <ShieldCheck size={13} /> Super admin
      </span>
      <h1 className="mt-3 text-2xl">Sign in</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Panel access, and the vendor invoice vault for the accountant.
      </p>

      <form action={signIn} className="mt-7 space-y-4">
        <Field label="Email or employee ID">
          <input name="identifier" autoComplete="username" required autoFocus className="input" placeholder="you@bhealix.com" />
        </Field>
        <Field label="Password">
          <PasswordInput name="password" autoComplete="current-password" required placeholder="••••••••" />
        </Field>
        {error && <p role="alert" className="rounded-[10px] bg-[var(--danger-bg)] px-3 py-2.5 text-sm font-medium text-[var(--danger-ink)]">{error}</p>}
        <Button type="submit" busy={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
      </form>

      {/*
        * Said out loud rather than left to be assumed. This address is not a
        * secret and knowing it grants nothing — the password and the role are
        * what protect the account, and there is no second credential to lose.
        */}
      <p className="mt-6 text-center text-xs text-[var(--muted)]">
        A super administrator is created from a shell, not from the Employees screen.
      </p>
      <p className="mt-3 text-center text-xs text-[var(--muted)]">
        Not a super administrator?{" "}
        <Link href="/login" className="font-semibold text-[var(--brand)] hover:underline">Staff sign in</Link>
      </p>
    </div>
  </main>;
}
