import Link from "next/link";
import { CheckCircle2, CircleAlert, FileArchive, KeyRound, Users } from "lucide-react";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { Badge, Card, LinkButton, PageTitle, Stat } from "@/components/ui/kit";
import { grantedWorkspaces } from "@/lib/auth/grants";
import { summarise } from "@/lib/finance/documents";
import { currentPeriod, formatPeriod, shiftPeriod } from "@/lib/finance/period";
import { sourceOf } from "@/lib/finance/sources";
import { isGrantable, WORKSPACE_LABEL, type GrantableWorkspace } from "@/lib/workspace";
import type { Role } from "@/constants/access";

export const dynamic = "force-dynamic";

/**
 * The super administrator's own front page.
 *
 * Two things, because there are two things this panel is for: the state of the
 * books' paperwork, and who can get into what. Both are shown as the answer
 * rather than as a link to where the answer lives — "August is short a Meta
 * invoice" is the whole reason to open this screen, and having to click twice
 * for it would mean nobody looked until the accountant asked.
 *
 * Last month is shown alongside this one deliberately. On the fifth of
 * September, "August" is the month that matters and "September" is three days
 * old; a page that only knew about today would be showing an empty month and
 * saying nothing about the one being closed.
 */
export default async function ControlOverviewPage() {
  await connectDb();

  const thisMonth = currentPeriod();
  const lastMonth = shiftPeriod(thisMonth, -1);

  const [current, previous, accounts] = await Promise.all([
    summarise(thisMonth),
    summarise(lastMonth),
    User.find({ role: { $in: ["SUPERADMIN", "ADMIN", "HR"] }, active: { $ne: false } })
      .select("role workspaces").lean() as unknown as Promise<{ role: Role; workspaces?: unknown }[]>
  ]);

  const holders = (workspace: GrantableWorkspace) => accounts.filter(account =>
    account.role === "SUPERADMIN" ||
    grantedWorkspaces(account.role, Array.isArray(account.workspaces) ? account.workspaces.filter(isGrantable) : undefined).includes(workspace)
  ).length;

  return <div className="space-y-5">
    <PageTitle
      title="Super admin"
      subtitle="The company's own paperwork, and who may open which CRM."
    />

    <div className="grid gap-4 lg:grid-cols-2">
      {[previous, current].map(summary => {
        const closing = summary.period === lastMonth;
        return <Card key={summary.period} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{formatPeriod(summary.period)}</h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {closing ? "The month being closed" : "This month, still filling up"}
              </p>
            </div>
            {summary.handedOverAt
              ? <Badge tone="success"><CheckCircle2 size={12} className="mr-1" /> Sent to CA</Badge>
              : summary.missing.length
                ? <Badge tone="warn"><CircleAlert size={12} className="mr-1" /> {summary.missing.length} missing</Badge>
                : <Badge tone="info">Complete</Badge>}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Documents" value={summary.documents} />
            <Stat label="Billed" value={`₹${summary.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
            <Stat label="Tax" value={`₹${summary.taxAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
          </div>

          {summary.missing.length > 0 && <p className="mt-4 text-sm text-[var(--warn-ink)]">
            Nothing filed for {summary.missing.map(key => `${sourceOf(key).vendor} ${sourceOf(key).label.toLowerCase()}`).join(", ")}.
          </p>}

          {summary.note && <p className="mt-3 rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-2)]">{summary.note}</p>}

          <div className="mt-4">
            <LinkButton tone="secondary" href={`/admin/control/invoices?period=${summary.period}`}>
              <FileArchive size={16} /> Open the vault
            </LinkButton>
          </div>
        </Card>;
      })}
    </div>

    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><KeyRound size={17} /> Panel access</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {accounts.length} desk account{accounts.length === 1 ? "" : "s"} can sign in.
          </p>
        </div>
        <LinkButton tone="secondary" href="/admin/control/access"><Users size={16} /> Manage access</LinkButton>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-sm">
        {(["doctor", "sales"] as const).map(workspace => (
          <Stat key={workspace} label={`${WORKSPACE_LABEL[workspace]} holders`} value={holders(workspace)} />
        ))}
      </div>

      <p className="mt-4 text-xs text-[var(--muted)]">
        Changes take effect at once — see{" "}
        <Link href="/admin/control/access" className="font-semibold text-[var(--brand)] hover:underline">panel access</Link>.
      </p>
    </Card>
  </div>;
}
