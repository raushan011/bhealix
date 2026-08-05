import Link from "next/link";
import { Boxes, CalendarOff, ChevronRight, History, LogOut, Stethoscope, UserPlus, UserRound } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { Card, PageTitle } from "@/components/ui/kit";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ROLE_LABEL } from "@/constants/access";

export const dynamic = "force-dynamic";

/**
 * Everything that does not earn a place in the tab bar.
 *
 * A page rather than a pop-up sheet: it keeps its own address, so the back
 * button behaves and a link can point straight at it.
 */
const LINKS = [
  { href: "/employee/doctors/new", label: "Add a doctor", hint: "Search by name, or enter one by hand", icon: UserPlus },
  { href: "/employee/samples", label: "My samples", hint: "What you were given and what you handed over", icon: Boxes },
  { href: "/employee/history", label: "Visit history", hint: "Everywhere you have been", icon: History },
  { href: "/employee/leave", label: "Leave", hint: "Ask for time off and see where it stands", icon: CalendarOff },
  { href: "/employee/doctors", label: "Doctor directory", hint: "Look anybody up and fix their call time", icon: Stethoscope },
  { href: "/employee/profile", label: "Profile and password", hint: "Your own details", icon: UserRound }
];

export default async function MorePage() {
  const session = await requireFieldPanel();

  return <div className="space-y-4">
    <PageTitle title="More" subtitle={`${session.name} · ${ROLE_LABEL[session.role]}`} />

    <Card className="divide-y divide-[var(--line)]">
      {LINKS.map(({ href, label, hint, icon: Icon }) => (
        <Link key={href} href={href} className="flex items-center gap-3 px-4 py-3.5 active:bg-[var(--surface-2)]">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--brand-soft)] text-[var(--brand)]">
            <Icon size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{label}</span>
            <span className="block truncate text-xs text-[var(--muted)]">{hint}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
        </Link>
      ))}
    </Card>

    <Card className="p-2">
      <SignOutButton className="tap flex w-full items-center justify-center gap-2 rounded-[10px] text-sm font-semibold text-rose-600">
        <LogOut size={16} />Sign out
      </SignOutButton>
    </Card>
  </div>;
}
