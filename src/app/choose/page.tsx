import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck, Stethoscope, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { panelsForSession } from "@/lib/auth/access";
import { homeFor, usesAdminPanel } from "@/constants/access";
import { Brand } from "@/components/ui/brand";
import { Appearance } from "@/components/ui/appearance";
import { WORKSPACE_BLURB, WORKSPACE_HOME, WORKSPACE_LABEL, type Workspace } from "@/lib/workspace";

const ICON: Record<Workspace, React.ComponentType<{ size?: number; className?: string }>> = {
  doctor: Stethoscope,
  sales: TrendingUp,
  control: ShieldCheck
};

/**
 * Which CRM did you come for?
 *
 * Shown once, on the way in. It is not a preference to be remembered — the
 * operations live at different paths, so the answer is the link you follow, and
 * the sidebar carries a way back here.
 *
 * The cards are the panels this person has actually been granted, rather than
 * the panels that exist. Somebody with one door is sent straight through it
 * instead of being asked a question with one answer, and somebody with none is
 * told so plainly — that is a real state now that access can be withdrawn, and a
 * chooser showing zero cards with no explanation would read as a broken page.
 */
export default async function ChoosePage() {
  const session = await requireSession();
  if (!usesAdminPanel(session.role)) redirect(homeFor(session.role));

  const panels = await panelsForSession(session);
  if (panels.length === 1) redirect(WORKSPACE_HOME[panels[0]]);

  const first = session.name.trim().split(/\s+/)[0] || "there";

  return <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
    <Appearance className="fixed right-3 top-3" />

    <div className="page-enter w-full max-w-[760px]">
      <Brand />
      <h1 className="mt-9 text-2xl">Welcome back, {first}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {panels.length ? "Which side of the business are you working on?" : "Your account is signed in, but no panel has been assigned to it."}
      </p>

      {panels.length ? <>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {panels.map(workspace => <Choice key={workspace} workspace={workspace} />)}
        </div>
        <p className="mt-6 text-center text-xs text-[var(--muted)]">
          You can switch between them at any time from the sidebar.
        </p>
      </> : (
        <p className="card mt-7 px-5 py-6 text-sm text-[var(--muted)]">
          Ask a super administrator to give you the Doctor CRM, the Sales CRM, or both. Nothing is
          missing from your account — the panels simply have not been turned on for it yet.
        </p>
      )}
    </div>
  </main>;
}

function Choice({ workspace }: { workspace: Workspace }) {
  const Icon = ICON[workspace];
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
