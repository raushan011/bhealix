import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Stethoscope, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { can, homeFor, usesAdminPanel } from "@/constants/access";
import { Brand } from "@/components/ui/brand";
import { Appearance } from "@/components/ui/appearance";
import { WORKSPACE_BLURB, WORKSPACE_HOME, WORKSPACE_LABEL } from "@/lib/workspace";

/**
 * Which CRM did you come for?
 *
 * Shown once, on the way in. It is not a preference to be remembered — the two
 * operations live at different paths, so the answer is the link you follow, and
 * the sidebar carries a way back here.
 *
 * Somebody who cannot reach the affiliate side is not shown a door they will be
 * refused at: with only one card to press, they are sent straight through it.
 */
export default async function ChoosePage() {
  const session = await requireSession();
  if (!usesAdminPanel(session.role)) redirect(homeFor(session.role));
  if (!can.viewSales(session.role)) redirect(WORKSPACE_HOME.doctor);

  const first = session.name.trim().split(/\s+/)[0] || "there";

  return <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
    <Appearance className="fixed right-3 top-3" />

    <div className="page-enter w-full max-w-[760px]">
      <Brand />
      <h1 className="mt-9 text-2xl">Welcome back, {first}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Which side of the business are you working on?</p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <Choice workspace="doctor" icon={Stethoscope} />
        <Choice workspace="sales" icon={TrendingUp} />
      </div>

      <p className="mt-6 text-center text-xs text-[var(--muted)]">
        You can switch between them at any time from the sidebar.
      </p>
    </div>
  </main>;
}

function Choice({ workspace, icon: Icon }: {
  workspace: "doctor" | "sales";
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return <Link
    href={WORKSPACE_HOME[workspace]}
    className="card group flex flex-col gap-3 p-6 transition-colors hover:border-[var(--brand)] hover:bg-[var(--surface-2)]"
  >
    <span className="grid size-11 place-items-center rounded-[12px] bg-[var(--brand-soft)] text-[var(--brand)]">
      <Icon size={22} />
    </span>
    <span className="flex items-center gap-1.5 text-base font-semibold">
      {WORKSPACE_LABEL[workspace]}
      <ArrowRight size={16} className="text-[var(--muted)] transition-transform group-hover:translate-x-0.5" />
    </span>
    <span className="text-sm text-[var(--muted)]">{WORKSPACE_BLURB[workspace]}</span>
  </Link>;
}
