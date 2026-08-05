"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarCheck, LayoutGrid, LogOut, Receipt, Route, Stethoscope } from "lucide-react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { BrandMark } from "@/components/ui/brand";
import { ROLE_LABEL, type Role } from "@/constants/access";

/**
 * Five tabs, because that is what a thumb can hit reliably on a 360px phone.
 * The four screens a rep opens all day get a tab of their own; everything they
 * reach for occasionally lives behind More, which is a real page rather than a
 * pop-up menu so it survives a back button.
 */
const TABS = [
  { href: "/employee", label: "Today", icon: CalendarCheck },
  { href: "/employee/plans", label: "Plans", icon: Route },
  { href: "/employee/doctors", label: "Doctors", icon: Stethoscope },
  { href: "/employee/bills", label: "Bills", icon: Receipt },
  { href: "/employee/more", label: "More", icon: LayoutGrid }
] as const;

/** The paths More owns, so its tab stays lit while the rep is inside one. */
const UNDER_MORE = ["/employee/more", "/employee/samples", "/employee/history", "/employee/leave", "/employee/profile"];

function isActive(pathname: string, href: string) {
  if (href === "/employee") return pathname === "/employee";
  if (href === "/employee/more") return UNDER_MORE.some(path => pathname.startsWith(path));
  return pathname.startsWith(href);
}

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
      <div className="mx-auto grid h-[68px] max-w-2xl grid-cols-5">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}>
            <Icon size={21} className="shrink-0" /><span className="w-full truncate text-center">{label}</span>
          </Link>;
        })}
      </div>
    </nav>
  </div>;
}
