"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgeIndianRupee, BarChart3, BellRing, CalendarOff, Home, LogOut, MoreHorizontal, PackagePlus, ShoppingBag,
  UserRound, UserRoundSearch, Wallet, X
} from "lucide-react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { NavIcon } from "@/components/layout/nav-icon";
import { Brand, BrandMark } from "@/components/ui/brand";
import { Appearance } from "@/components/ui/appearance";

/**
 * The sales executive's own panel — built for a phone first.
 *
 * Executives work from their phones: ringing a lead between two calls, booking a
 * parcel while the customer is still on the line. So on a phone the four things
 * done all day sit in a bottom bar under the thumb — Today, Leads, New order,
 * Orders — and everything else is one tap away under More. On a desk the same
 * links become a sidebar.
 */
const NAV = [
  { href: "/executive", label: "Today", icon: Home, group: "", tab: true },
  { href: "/executive/follow-ups", label: "Follow-ups", icon: BellRing, group: "Sell", tab: false },
  { href: "/executive/leads", label: "Leads", icon: UserRoundSearch, group: "Sell", tab: true },
  { href: "/executive/orders/new", label: "New order", icon: PackagePlus, group: "Sell", tab: true },
  { href: "/executive/orders", label: "Orders", icon: ShoppingBag, group: "Sell", tab: true },
  { href: "/executive/incentives", label: "Incentives", icon: BadgeIndianRupee, group: "Earnings", tab: false },
  { href: "/executive/performance", label: "My numbers", icon: BarChart3, group: "Earnings", tab: false },
  { href: "/executive/leave", label: "Leave", icon: CalendarOff, group: "Me", tab: false },
  { href: "/executive/payslips", label: "Payslips", icon: Wallet, group: "Me", tab: false },
  { href: "/executive/profile", label: "Profile", icon: UserRound, group: "Me", tab: false }
] as const;

const isActive = (pathname: string, href: string) => {
  if (href === "/executive") return pathname === href;
  if (href === "/executive/orders") return pathname === href || /^\/executive\/orders\/(?!new)/.test(pathname);
  return pathname.startsWith(href);
};
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "?";

export function ExecutiveShell({ user, children }: { user: { name: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const groups = [...new Set(NAV.map(item => item.group))];
  const navList = (onPick?: () => void) => (
    <nav className="space-y-3">
      {groups.map(group => (
        <div key={group} className="space-y-0.5">
          {group && <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">{group}</p>}
          {NAV.filter(item => item.group === group).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={onPick}
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

  const tabs = NAV.filter(item => item.tab);
  const moreActive = !tabs.some(item => isActive(pathname, item.href));

  return <div className="min-h-[100dvh] lg:grid lg:grid-cols-[248px_1fr] lg:items-start">
    <aside className="hidden border-r border-[var(--line)] bg-[var(--surface)] px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:flex-col">
      <div className="px-2"><Brand subtitle="Sales" /></div>
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">{navList()}</div>
      {account}
    </aside>

    <div className="min-w-0">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[var(--surface-veil)] px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2"><BrandMark size={28} /><span className="text-sm font-bold tracking-[0.14em] text-[var(--brand)]">BHEALIX</span></div>
        <span className="grid size-8 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-[var(--on-brand)]">{initials(user.name)}</span>
      </header>

      {/* Room at the bottom on a phone, so the last card is never hidden under the tab bar. */}
      <main key={pathname} className="page-enter mx-auto w-full max-w-[1180px] px-3 pb-28 pt-4 sm:px-6 lg:px-8 lg:py-8">
        <InstallPrompt description="Install it on your phone for a full-screen app and a home-screen icon." />
        {children}
      </main>
    </div>

    {/* The phone's bottom bar: the four things done all day, under the thumb. */}
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
      <div className="mx-auto grid max-w-[520px] grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const primary = href === "/executive/orders/new";
          return <Link key={href} href={href} className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}>
            {primary
              ? <span className="grid size-10 place-items-center rounded-full bg-[var(--brand)] text-[var(--on-brand)] shadow"><Icon size={20} /></span>
              : <Icon size={21} />}
            <span>{primary ? "New" : label}</span>
          </Link>;
        })}
        <button onClick={() => setMoreOpen(true)} className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${moreActive ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}>
          <MoreHorizontal size={21} /><span>More</span>
        </button>
      </div>
    </nav>

    {moreOpen && <div className="fixed inset-0 z-40 lg:hidden">
      <button aria-label="Close menu" tabIndex={-1} onClick={() => setMoreOpen(false)} className="absolute inset-0 cursor-default bg-[var(--overlay)]" />
      <div className="page-enter absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-[var(--surface)] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <div className="mb-2 flex items-center justify-between">
          <Brand subtitle="Sales" />
          <button onClick={() => setMoreOpen(false)} aria-label="Close menu" className="tap grid place-items-center rounded-[10px] text-[var(--muted)]"><X size={19} /></button>
        </div>
        {navList(() => setMoreOpen(false))}
        <div className="mt-4">{account}</div>
      </div>
    </div>}
  </div>;
}
