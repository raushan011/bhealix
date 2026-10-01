"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BadgeIndianRupee, CalendarOff, LayoutDashboard, LogOut, Menu, PackagePlus, ShoppingBag, UserRound, UserRoundSearch, Wallet, X } from "lucide-react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { NavIcon } from "@/components/layout/nav-icon";
import { Brand, BrandMark } from "@/components/ui/brand";
import { Appearance } from "@/components/ui/appearance";

/**
 * The sales executive's own panel.
 *
 * A sidebar on a desk and a drawer on a phone, because the job is done on both:
 * leads are rung from a headset at a desk and from a phone on the way home. It
 * holds only what is the executive's own — their leads, their orders, their
 * incentives, their leave and payslips — and nothing of anybody else's.
 */
const NAV = [
  { href: "/executive", label: "Dashboard", icon: LayoutDashboard, group: "" },
  { href: "/executive/leads", label: "My leads", icon: UserRoundSearch, group: "Sell" },
  { href: "/executive/orders/new", label: "New order", icon: PackagePlus, group: "Sell" },
  { href: "/executive/orders", label: "My orders", icon: ShoppingBag, group: "Sell" },
  { href: "/executive/incentives", label: "Incentives", icon: BadgeIndianRupee, group: "Sell" },
  { href: "/executive/leave", label: "Leave", icon: CalendarOff, group: "Me" },
  { href: "/executive/payslips", label: "Payslips", icon: Wallet, group: "Me" },
  { href: "/executive/profile", label: "Profile", icon: UserRound, group: "Me" }
] as const;

const EXACT = new Set(["/executive", "/executive/orders"]);
const isActive = (pathname: string, href: string) =>
  EXACT.has(href) ? pathname === href || (href === "/executive/orders" && /^\/executive\/orders\/(?!new)/.test(pathname)) : pathname.startsWith(href);
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "?";

export function ExecutiveShell({ user, children }: { user: { name: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const groups = [...new Set(NAV.map(item => item.group))];
  const navList = (
    <nav className="space-y-3">
      {groups.map(group => (
        <div key={group} className="space-y-0.5">
          {group && <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">{group}</p>}
          {NAV.filter(item => item.group === group).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMenuOpen(false)}
              className={`tap flex items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors ${
                isActive(pathname, href) ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
              }`}>
              <NavIcon icon={Icon} />{label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  const account = (
    <div className="flex items-center gap-1 border-t border-[var(--line)] px-2 pt-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-xs font-bold text-[var(--on-brand)]">{initials(user.name)}</span>
      <div className="ml-2 min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{user.name}</p>
        <p className="truncate text-xs text-[var(--muted)]">Sales executive</p>
      </div>
      <Appearance />
      <button onClick={signOut} aria-label="Sign out" className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><LogOut size={17} /></button>
    </div>
  );

  return <div className="min-h-[100dvh] lg:grid lg:grid-cols-[248px_1fr] lg:items-start">
    <aside className="hidden border-r border-[var(--line)] bg-[var(--surface)] px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:flex-col">
      <div className="px-2"><Brand subtitle="Sales" /></div>
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">{navList}</div>
      {account}
    </aside>

    <div className="min-w-0">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[var(--surface-veil)] px-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2"><BrandMark size={30} /><span className="text-sm font-bold tracking-[0.14em] text-[var(--brand)]">BHEALIX</span></div>
        <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="tap grid place-items-center rounded-[10px] text-[var(--ink-2)]"><Menu size={20} /></button>
      </header>

      {menuOpen && <div className="fixed inset-0 z-40 lg:hidden">
        <button aria-label="Close menu" tabIndex={-1} onClick={() => setMenuOpen(false)} className="absolute inset-0 cursor-default bg-[var(--overlay)]" />
        <div className="relative ml-auto flex h-full w-[80%] max-w-[300px] flex-col bg-[var(--surface)] px-4 py-5">
          <div className="flex items-center justify-between">
            <Brand subtitle="Sales" />
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="tap grid place-items-center rounded-[10px] text-[var(--muted)]"><X size={19} /></button>
          </div>
          <div className="mt-6 flex-1 overflow-y-auto">{navList}</div>
          {account}
        </div>
      </div>}

      <main key={pathname} className="page-enter mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <InstallPrompt description="Install it for a full-screen window and a home-screen icon." />
        {children}
      </main>
    </div>
  </div>;
}
