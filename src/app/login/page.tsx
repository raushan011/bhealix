"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Brand } from "@/components/ui/brand";
import { Button, Field } from "@/components/ui/kit";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      router.replace(next ?? json.data?.redirectTo ?? "/");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not sign in");
      setBusy(false);
    }
  }

  return <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
    <div className="w-full max-w-[380px]">
      <Brand />
      <h1 className="mt-9 text-2xl">Sign in</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Doctor discovery, call planning and field visits.</p>

      <form action={signIn} className="mt-7 space-y-4">
        <Field label="Email or employee ID">
          <input name="identifier" autoComplete="username" required autoFocus className="input" placeholder="you@bhealix.com" />
        </Field>
        <Field label="Password">
          <input name="password" type="password" autoComplete="current-password" required className="input" placeholder="••••••••" />
        </Field>
        {error && <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">{error}</p>}
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
