"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Boxes, CalendarCheck, History, LogOut, Receipt, Route, Stethoscope, UserRound } from "lucide-react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { BrandMark } from "@/components/ui/brand";
import { ROLE_LABEL, type Role } from "@/constants/access";

const TABS = [
  { href: "/employee", label: "Today", icon: CalendarCheck },
  { href: "/employee/plans", label: "Plans", icon: Route },
  { href: "/employee/doctors", label: "Doctors", icon: Stethoscope },
  { href: "/employee/bills", label: "Bills", icon: Receipt },
  { href: "/employee/samples", label: "Samples", icon: Boxes },
  { href: "/employee/history", label: "History", icon: History },
  { href: "/employee/profile", label: "Profile", icon: UserRound }
] as const;

const isActive = (pathname: string, href: string) => href === "/employee" ? pathname === "/employee" : pathname.startsWith(href);

/**
 * Phone-first: content is a single column with a thumb-reachable tab bar that
 * clears the iOS home indicator. On desktop the same column is simply centred.
 */
export function FieldShell({ user, children }: { user: { name: string; role: Role }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return <div className="min-h-[100dvh] pb-[calc(68px+env(safe-area-inset-bottom))]">
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark size={30} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{user.name}</p>
            <p className="truncate text-[11px] text-[var(--muted)]">{ROLE_LABEL[user.role]}</p>
          </div>
        </div>
        <button onClick={signOut} aria-label="Sign out" className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><LogOut size={18} /></button>
      </div>
    </header>

    {/* Keyed on the path so the entrance animation replays on every tab change. */}
    <main key={pathname} className="page-enter mx-auto w-full max-w-2xl px-4 py-5">
      <InstallPrompt />
      {children}
    </main>

    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-white pb-[env(safe-area-inset-bottom)]">
      {/* Seven tabs is the most this bar takes on a 360px phone, so the label
          shrinks rather than wrapping onto a second line. */}
      <div className="mx-auto grid h-[68px] max-w-2xl grid-cols-7">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium ${active ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}>
            <Icon size={20} className="shrink-0" /><span className="w-full truncate text-center">{label}</span>
          </Link>;
        })}
      </div>
    </nav>
  </div>;
}
