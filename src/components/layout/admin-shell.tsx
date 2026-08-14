"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BadgePercent, BarChart3, Boxes, Building2, CalendarCheck, CalendarDays, CalendarRange, ClipboardCheck, ClipboardList, HeartHandshake, LayoutDashboard, LogOut, Menu, Package, Receipt, Repeat, Search, Settings, ShoppingBag, Stethoscope, Tag, Users, Wallet, Warehouse, X } from "lucide-react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { Brand, BrandMark } from "@/components/ui/brand";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ROLE_LABEL, can, type Role } from "@/constants/access";
import { CHOOSE_PATH, WORKSPACE_LABEL, workspaceOf, type Workspace } from "@/lib/workspace";

/**
 * Grouped, because the desk serves two jobs. An administrator runs the field
 * operation and the books; HR runs the people. Showing each their own headings
 * is what stops the sidebar reading as one undifferentiated list of twelve.
 *
 * `workspace` splits it again, into the two CRMs that share this panel. The
 * affiliate operation has nothing to do with doctors, route plans or payroll,
 * and showing all of it at once would put twenty unrelated links in one column.
 */
const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "HR"], group: "", workspace: "doctor" },
  { href: "/admin/discover", label: "Find doctors", icon: Search, roles: ["ADMIN"], group: "Field", workspace: "doctor" },
  { href: "/admin/doctors", label: "Doctors", icon: Stethoscope, roles: ["ADMIN"], group: "Field", workspace: "doctor" },
  { href: "/admin/plans", label: "Route plans", icon: CalendarRange, roles: ["ADMIN"], group: "Field", workspace: "doctor" },
  { href: "/admin/visits", label: "Visits", icon: ClipboardList, roles: ["ADMIN"], group: "Field", workspace: "doctor" },
  { href: "/admin/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN"], group: "Field", workspace: "doctor" },

  { href: "/admin/billing", label: "Billing", icon: Receipt, roles: ["ADMIN", "HR"], group: "Trade", workspace: "doctor" },
  { href: "/admin/customers", label: "Customers", icon: Building2, roles: ["ADMIN", "HR"], group: "Trade", workspace: "doctor" },
  { href: "/admin/inventory", label: "Inventory", icon: Warehouse, roles: ["ADMIN", "HR"], group: "Trade", workspace: "doctor" },
  { href: "/admin/products", label: "Products", icon: Package, roles: ["ADMIN"], group: "Trade", workspace: "doctor" },
  { href: "/admin/samples", label: "Samples", icon: Boxes, roles: ["ADMIN", "HR"], group: "Trade", workspace: "doctor" },

  { href: "/admin/hr", label: "People", icon: HeartHandshake, roles: ["ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/team", label: "Employees", icon: Users, roles: ["ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/hr/attendance", label: "Attendance", icon: CalendarCheck, roles: ["ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/hr/leave", label: "Leave", icon: ClipboardCheck, roles: ["ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/hr/holidays", label: "Holidays", icon: CalendarDays, roles: ["ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/hr/payroll", label: "Payroll", icon: Wallet, roles: ["ADMIN", "HR"], group: "People", workspace: "doctor" },

  { href: "/admin/sales", label: "Overview", icon: LayoutDashboard, roles: ["ADMIN", "HR"], group: "", workspace: "sales" },
  { href: "/admin/sales/leads", label: "Leads", icon: Search, roles: ["ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  // "Partners", not "Sales team". The Doctor CRM's Employees screen next door
  // holds field sales executives, who are staff; this holds outside affiliates.
  // Two links reading "sales …" in one application is how the two got confused.
  { href: "/admin/sales/reps", label: "Partners", icon: Users, roles: ["ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  { href: "/admin/sales/coupons", label: "Coupons", icon: Tag, roles: ["ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  { href: "/admin/sales/orders", label: "Orders", icon: ShoppingBag, roles: ["ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  { href: "/admin/sales/payouts", label: "Payouts", icon: BadgePercent, roles: ["ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  { href: "/admin/sales/settings", label: "Settings", icon: Settings, roles: ["ADMIN"], group: "Affiliate", workspace: "sales" }
] as const;

/**
 * Exact matching for the three that sit above others in the same path —
 * /admin/hr is the People dashboard, not an ancestor of Attendance, and
 * /admin/sales is the affiliate overview rather than all of it. Either would
 * otherwise light up on every screen beneath them at once.
 */
const EXACT = new Set(["/admin", "/admin/hr", "/admin/sales"]);
const isActive = (pathname: string, href: string) =>
  EXACT.has(href) ? pathname === href : pathname.startsWith(href);
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "?";

export function AdminShell({ user, children }: { user: { name: string; role: Role }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // The path decides which CRM this is, so the sidebar can never describe a
  // different application from the one on screen.
  const workspace: Workspace = workspaceOf(pathname);
  const items = NAV.filter(item => item.workspace === workspace && (item.roles as readonly string[]).includes(user.role));
  // Nobody is offered a switch to somewhere they would be refused.
  const maySwitch = can.viewSales(user.role);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  // Only headings with something under them for this role are drawn, so HR does
  // not see an empty "Field" heading.
  const groups = [...new Set(items.map(item => item.group))];

  const switcher = maySwitch && (
    <Link href={CHOOSE_PATH} onClick={() => setMenuOpen(false)}
      className="tap mt-4 flex items-center gap-2 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)]">
      <Repeat size={14} className="shrink-0" />
      Switch CRM
    </Link>
  );

  const navList = (
    <nav className="space-y-3">
      {groups.map(group => (
        <div key={group} className="space-y-0.5">
          {group && (
            <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">{group}</p>
          )}
          {items.filter(item => item.group === group).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMenuOpen(false)}
              className={`tap flex items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors ${
                isActive(pathname, href) ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
              }`}>
              <Icon size={18} className="shrink-0" />{label}
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
        <p className="truncate text-xs text-[var(--muted)]">{ROLE_LABEL[user.role]}</p>
      </div>
      <ThemeToggle />
      <button onClick={signOut} aria-label="Sign out" className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><LogOut size={17} /></button>
    </div>
  );

  return <div className="min-h-[100dvh] lg:grid lg:grid-cols-[248px_1fr] lg:items-start">
    {/* Pinned to the viewport so navigation stays reachable however far the page scrolls. */}
    <aside className="hidden border-r border-[var(--line)] bg-[var(--surface)] px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:flex-col">
      <div className="px-2"><Brand subtitle={WORKSPACE_LABEL[workspace]} />{switcher}</div>
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
            <Brand subtitle={WORKSPACE_LABEL[workspace]} />
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="tap grid place-items-center rounded-[10px] text-[var(--muted)]"><X size={19} /></button>
          </div>
          {switcher}
          <div className="mt-6 flex-1 overflow-y-auto">{navList}</div>
          {account}
        </div>
      </div>}

      {/* Keyed on the path so the entrance animation replays on every navigation. */}
      <main key={pathname} className="page-enter mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <InstallPrompt description="Install it for a full-screen window and a desktop icon, without the browser chrome." />
        {children}
      </main>
    </div>
  </div>;
}
