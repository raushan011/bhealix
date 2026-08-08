"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Brand, BrandMark } from "@/components/ui/brand";
import { Button, Field } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import { ThemeToggle } from "@/components/ui/theme-toggle";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingOver, setHandingOver] = useState(false);

  async function signIn(data: FormData) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: data.get("identifier"), password: data.get("password") })
      });
      const json = await response.json() as { error?: string; data?: { redirectTo: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not sign in");

      // The panel is server-rendered, so there is a beat between here and the
      // first paint. Cover it deliberately instead of leaving a dead form on
      // screen, and leave `busy` set so nothing can be submitted twice.
      setHandingOver(true);
      router.replace(next ?? json.data?.redirectTo ?? "/");
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
    {/* Before anybody has an account to remember a preference against, so it
        sits in the corner rather than in a panel they cannot reach yet. */}
    <ThemeToggle className="fixed right-3 top-3" />
    <div className="page-enter w-full max-w-[380px]">
      <Brand />
      <h1 className="mt-9 text-2xl">Sign in</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Doctor discovery, call planning and field visits.</p>

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

      <p className="mt-6 text-center text-xs text-[var(--muted)]">
        Forgot your password? Ask your administrator to reset it.
      </p>
    </div>
  </main>;
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
