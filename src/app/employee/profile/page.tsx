"use client";

import { useEffect, useState } from "react";
import { KeyRound, UserRound } from "lucide-react";
import { Button, Card, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import { ROLE_LABEL, type Role } from "@/constants/access";

type Me = { name: string; email: string; employeeId: string; role: Role };

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then((json: { data?: Me }) => setMe(json.data ?? null));
  }, []);

  async function changePassword(data: FormData) {
    setBusy(true); setResult(null);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not change your password");
      setResult({ tone: "success", text: "Password changed." });
    } catch (problem) {
      setResult({ tone: "error", text: problem instanceof Error ? problem.message : "Could not change your password" });
    } finally { setBusy(false); }
  }

  if (!me) return <Spinner label="Loading your profile…" />;

  return <div className="space-y-4">
    <PageTitle title="Profile" />

    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[var(--on-brand)]"><UserRound size={22} /></span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{me.name}</p>
          <p className="truncate text-sm text-[var(--muted)]">{ROLE_LABEL[me.role]} · {me.employeeId}</p>
          <p className="truncate text-xs text-[var(--muted)]">{me.email}</p>
        </div>
      </div>
    </Card>

    <Card className="p-4">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-[var(--brand)]" />
        <h2 className="text-[15px] font-semibold">Change password</h2>
      </div>
      <form action={changePassword} className="mt-4 space-y-4">
        <Field label="Current password"><PasswordInput name="currentPassword" required /></Field>
        <Field label="New password" hint="At least 8 characters"><PasswordInput name="newPassword" minLength={8} required /></Field>
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        <Button type="submit" busy={busy} className="w-full">{busy ? "Saving…" : "Change password"}</Button>
      </form>
    </Card>
  </div>;
}
