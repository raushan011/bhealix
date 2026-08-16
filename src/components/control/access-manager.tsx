"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Stethoscope, TrendingUp } from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import type { GrantableWorkspace } from "@/lib/workspace";

/**
 * Who may enter which CRM.
 *
 * One row per desk account, two switches on each. Everything about the screen is
 * built to make the state legible before anything is changed — which panels are
 * in force, and whether that is because somebody chose them or because nobody
 * ever has. Those two look identical on a row of switches and mean quite
 * different things: the second is a default that has never been examined, and
 * flipping it is the first decision anybody has taken about that account.
 *
 * Field staff do not appear. A medical representative has one panel, on a phone,
 * and it is neither of these — listing them would invite somebody to withdraw a
 * panel they never had.
 */

type Account = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  role: string;
  roleLabel: string;
  designation?: string;
  active: boolean;
  workspaces: GrantableWorkspace[];
  decided: boolean;
  locked: boolean;
  self: boolean;
};

const ICON: Record<GrantableWorkspace, React.ComponentType<{ size?: number }>> = {
  doctor: Stethoscope,
  sales: TrendingUp
};

export function AccessManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [workspaces, setWorkspaces] = useState<{ key: GrantableWorkspace; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  /** Which account is mid-save, so only its own switches go quiet. */
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/control/access");
    const json = await response.json() as { data?: { accounts: Account[]; workspaces: { key: GrantableWorkspace; label: string }[] }; error?: string };
    if (json.data) {
      setAccounts(json.data.accounts);
      setWorkspaces(json.data.workspaces);
    } else {
      setNotice({ tone: "error", text: json.error ?? "Could not read the accounts." });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * The whole set is sent, not the one switch that moved.
   *
   * That is what the screen holds, and it is also what makes two people editing
   * the same account at once produce one of their two intended states rather
   * than a third that neither chose.
   */
  async function grant(account: Account, workspace: GrantableWorkspace, on: boolean) {
    const next = on
      ? [...new Set([...account.workspaces, workspace])]
      : account.workspaces.filter(held => held !== workspace);

    setSaving(account.id);
    setNotice(null);

    const response = await fetch("/api/control/access", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: account.id, workspaces: next })
    });
    const json = await response.json() as { data?: { account: Account; message: string }; error?: string };
    setSaving(null);

    if (!response.ok || !json.data) {
      return setNotice({ tone: "error", text: json.error ?? "Could not change that." });
    }

    // Only the row that changed is replaced, so a long list does not jump.
    setAccounts(current => current.map(row => (row.id === account.id ? json.data!.account : row)));
    setNotice({ tone: "success", text: json.data.message });
  }

  return <div className="space-y-5">
    <PageTitle
      title="Panel access"
      subtitle="Which CRMs each desk account may open. Withdrawing one closes its screens and its API immediately — there is no waiting for anybody to sign out."
    />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {loading ? <Spinner label="Reading the accounts" />
      : !accounts.length ? <EmptyState icon={KeyRound} title="No desk accounts" description="Administrators and HR users appear here once they exist." />
      : <div className="space-y-3">
          {accounts.map(account => <Card key={account.id} className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{account.name}</p>
                  <Badge tone={account.locked ? "brand" : "neutral"}>{account.roleLabel}</Badge>
                  {account.self && <Badge tone="info">You</Badge>}
                  {!account.active && <Badge tone="danger">Signed out</Badge>}
                  {!account.decided && !account.locked && <Badge tone="neutral">Role default</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {account.employeeId} · {account.email}{account.designation ? ` · ${account.designation}` : ""}
                </p>
              </div>

              {account.locked
                ? <p className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                    <ShieldCheck size={14} /> Holds every panel by role
                  </p>
                : <div className="flex shrink-0 flex-wrap gap-2">
                    {workspaces.map(({ key, label }) => {
                      const Icon = ICON[key];
                      const on = account.workspaces.includes(key);
                      return <Button
                        key={key}
                        tone={on ? "primary" : "secondary"}
                        busy={saving === account.id}
                        aria-pressed={on}
                        onClick={() => grant(account, key, !on)}
                      >
                        <Icon size={15} />{label}
                      </Button>;
                    })}
                  </div>}
            </div>

            {!account.workspaces.length && !account.locked && <p className="mt-3 text-xs text-[var(--warn-ink)]">
              This account can sign in but has no CRM to enter. They will be shown a message asking for access.
            </p>}
          </Card>)}
        </div>}

    <Card className="p-5">
      <h2 className="text-sm font-semibold">How this works</h2>
      <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
        <li>· A panel that has never been decided shows as <strong>Role default</strong> — administrators and HR have had both since before this screen existed.</li>
        <li>· Withdrawing a panel takes effect on the next click, not on the next sign-in: the screens and the API behind them both check the grant on every request.</li>
        <li>· The role still applies underneath. Granting HR the Sales CRM lets them read it; it does not give them the authority to issue a coupon or approve a payout.</li>
        <li>· The super admin panel is not on this list on purpose. It comes with the role, so nobody can grant themselves the screen that hands out grants.</li>
      </ul>
    </Card>
  </div>;
}
