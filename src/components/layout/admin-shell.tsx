"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarRange, ClipboardList, LayoutDashboard, LogOut, Menu, Search, Stethoscope, Users, X } from "lucide-react";
import { Brand, BrandMark } from "@/components/ui/brand";
import { ROLE_LABEL, type Role } from "@/constants/access";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "HR"] },
  { href: "/admin/discover", label: "Find doctors", icon: Search, roles: ["ADMIN"] },
  { href: "/admin/doctors", label: "Doctors", icon: Stethoscope, roles: ["ADMIN"] },
  { href: "/admin/plans", label: "Route plans", icon: CalendarRange, roles: ["ADMIN"] },
  { href: "/admin/visits", label: "Visits", icon: ClipboardList, roles: ["ADMIN"] },
  { href: "/admin/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN"] },
  { href: "/admin/team", label: "Team", icon: Users, roles: ["ADMIN", "HR"] }
] as const;

const isActive = (pathname: string, href: string) => href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "?";

export function AdminShell({ user, children }: { user: { name: string; role: Role }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV.filter(item => (item.roles as readonly string[]).includes(user.role));

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const navList = (
    <nav className="space-y-0.5">
      {items.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} onClick={() => setMenuOpen(false)}
          className={`tap flex items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors ${
            isActive(pathname, href) ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
          }`}>
          <Icon size={18} className="shrink-0" />{label}
        </Link>
      ))}
    </nav>
  );

  const account = (
    <div className="flex items-center gap-3 border-t border-[var(--line)] px-2 pt-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-xs font-bold text-white">{initials(user.name)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{user.name}</p>
        <p className="truncate text-xs text-[var(--muted)]">{ROLE_LABEL[user.role]}</p>
      </div>
      <button onClick={signOut} aria-label="Sign out" className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><LogOut size={17} /></button>
    </div>
  );

  return <div className="min-h-[100dvh] lg:grid lg:grid-cols-[248px_1fr] lg:items-start">
    {/* Pinned to the viewport so navigation stays reachable however far the page scrolls. */}
    <aside className="hidden border-r border-[var(--line)] bg-white px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:flex-col">
      <div className="px-2"><Brand subtitle="Doctor CRM" /></div>
      <div className="mt-8 min-h-0 flex-1 overflow-y-auto">{navList}</div>
      {account}
    </aside>

    <div className="min-w-0">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[var(--line)] bg-white/95 px-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2"><BrandMark size={30} /><span className="text-sm font-bold tracking-[0.14em] text-[var(--brand)]">BHEALIX</span></div>
        <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="tap grid place-items-center rounded-[10px] text-[var(--ink-2)]"><Menu size={20} /></button>
      </header>

      {menuOpen && <div className="fixed inset-0 z-40 lg:hidden">
        <button aria-label="Close menu" tabIndex={-1} onClick={() => setMenuOpen(false)} className="absolute inset-0 cursor-default bg-black/40" />
        <div className="relative ml-auto flex h-full w-[80%] max-w-[300px] flex-col bg-white px-4 py-5">
          <div className="flex items-center justify-between">
            <Brand subtitle="Doctor CRM" />
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="tap grid place-items-center rounded-[10px] text-[var(--muted)]"><X size={19} /></button>
          </div>
          <div className="mt-7 flex-1 overflow-y-auto">{navList}</div>
          {account}
        </div>
      </div>}

      <main className="mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  </div>;
}
