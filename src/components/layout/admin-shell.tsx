"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BadgePercent, BarChart3, Boxes, Building2, CalendarCheck, CalendarDays, CalendarRange, ClipboardCheck, ClipboardList, FileArchive, HeartHandshake, KeyRound, LayoutDashboard, LogOut, Menu, Package, PhoneCall, Plug, Receipt, Repeat, Search, Settings, ShoppingBag, Stethoscope, Tag, Truck, Users, Wallet, Warehouse, X } from "lucide-react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { NavIcon } from "@/components/layout/nav-icon";
import { Brand, BrandMark } from "@/components/ui/brand";
import { Appearance } from "@/components/ui/appearance";
import { ROLE_LABEL, type Role } from "@/constants/access";
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
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "", workspace: "doctor" },
  { href: "/admin/discover", label: "Find doctors", icon: Search, roles: ["SUPERADMIN", "ADMIN"], group: "Field", workspace: "doctor" },
  { href: "/admin/doctors", label: "Doctors", icon: Stethoscope, roles: ["SUPERADMIN", "ADMIN"], group: "Field", workspace: "doctor" },
  { href: "/admin/plans", label: "Route plans", icon: CalendarRange, roles: ["SUPERADMIN", "ADMIN"], group: "Field", workspace: "doctor" },
  { href: "/admin/visits", label: "Visits", icon: ClipboardList, roles: ["SUPERADMIN", "ADMIN"], group: "Field", workspace: "doctor" },
  { href: "/admin/reports", label: "Reports", icon: BarChart3, roles: ["SUPERADMIN", "ADMIN"], group: "Field", workspace: "doctor" },

  { href: "/admin/billing", label: "Billing", icon: Receipt, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Trade", workspace: "doctor" },
  { href: "/admin/customers", label: "Customers", icon: Building2, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Trade", workspace: "doctor" },
  { href: "/admin/inventory", label: "Inventory", icon: Warehouse, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Trade", workspace: "doctor" },
  { href: "/admin/products", label: "Products", icon: Package, roles: ["SUPERADMIN", "ADMIN"], group: "Trade", workspace: "doctor" },
  { href: "/admin/samples", label: "Samples", icon: Boxes, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Trade", workspace: "doctor" },

  { href: "/admin/hr", label: "People", icon: HeartHandshake, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/team", label: "Employees", icon: Users, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/hr/attendance", label: "Attendance", icon: CalendarCheck, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/hr/leave", label: "Leave", icon: ClipboardCheck, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/hr/holidays", label: "Holidays", icon: CalendarDays, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "People", workspace: "doctor" },
  { href: "/admin/hr/payroll", label: "Payroll", icon: Wallet, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "People", workspace: "doctor" },

  { href: "/admin/sales", label: "Overview", icon: LayoutDashboard, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "", workspace: "sales" },
  { href: "/admin/sales/leads", label: "Leads", icon: Search, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  // "Partners", not "Sales team". The Doctor CRM's Employees screen next door
  // holds field sales executives, who are staff; this holds outside affiliates.
  // Two links reading "sales …" in one application is how the two got confused.
  { href: "/admin/sales/reps", label: "Partners", icon: Users, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  { href: "/admin/sales/coupons", label: "Coupons", icon: Tag, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  { href: "/admin/sales/orders", label: "Orders", icon: ShoppingBag, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  // Reading what came in and sending it are different jobs done by different
  // people at different times of day, so they are two screens rather than a mode
  // of one. Orders answers "what did this coupon bring in"; this one is the
  // morning's picking list.
  { href: "/admin/sales/orders/process", label: "Process orders", icon: Truck, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  { href: "/admin/sales/payouts", label: "Payouts", icon: BadgePercent, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  // Every order the shop took, whoever brought it in, as a calling list —
  // the one screen here that is about the whole customer base rather than
  // the partners' slice of it.
  { href: "/admin/sales/retarget", label: "Retarget", icon: PhoneCall, roles: ["SUPERADMIN", "ADMIN", "HR"], group: "Affiliate", workspace: "sales" },
  { href: "/admin/sales/settings", label: "Settings", icon: Settings, roles: ["SUPERADMIN", "ADMIN"], group: "Affiliate", workspace: "sales" },

  { href: "/admin/control", label: "Overview", icon: LayoutDashboard, roles: ["SUPERADMIN"], group: "", workspace: "control" },
  { href: "/admin/control/invoices", label: "Invoice vault", icon: FileArchive, roles: ["SUPERADMIN"], group: "Accounts", workspace: "control" },
  { href: "/admin/control/connections", label: "Connections", icon: Plug, roles: ["SUPERADMIN"], group: "Accounts", workspace: "control" },
  { href: "/admin/control/access", label: "Panel access", icon: KeyRound, roles: ["SUPERADMIN"], group: "Control", workspace: "control" },
  { href: "/admin/control/users", label: "Users", icon: Users, roles: ["SUPERADMIN"], group: "Control", workspace: "control" }
] as const;

/**
 * Exact matching for the five that sit above others in the same path —
 * /admin/hr is the People dashboard, not an ancestor of Attendance,
 * /admin/sales is the affiliate overview rather than all of it,
 * /admin/sales/orders is the order list rather than the processing screen
 * beneath it, and /admin/control is the super admin overview rather than the
 * vault and the access screen under it. Any of them would otherwise light up
 * alongside the screen actually being looked at.
 */
const EXACT = new Set(["/admin", "/admin/hr", "/admin/sales", "/admin/sales/orders", "/admin/control"]);
const isActive = (pathname: string, href: string) =>
  EXACT.has(href) ? pathname === href : pathname.startsWith(href);
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "?";

/**
 * `panels` is resolved on the server and handed down rather than worked out from
 * the role here. Which CRMs somebody holds is a decision recorded in the
 * database, and a client component cannot read it — guessing from the role would
 * offer a "Switch CRM" link to a panel the guard is about to refuse, which is
 * the one thing a switcher must never do.
 */
export function AdminShell({ user, panels, children }: {
  user: { name: string; role: Role };
  panels: readonly Workspace[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // The path decides which CRM this is, so the sidebar can never describe a
  // different application from the one on screen.
  const workspace: Workspace = workspaceOf(pathname);
  const items = NAV.filter(item => item.workspace === workspace && (item.roles as readonly string[]).includes(user.role));
  // Nobody is offered a switch to somewhere they would be refused, and nobody is
  // offered a choice between one thing and itself.
  const maySwitch = panels.length > 1;

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
      <NavIcon icon={Repeat} size={14} />
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
        <p className="truncate text-xs text-[var(--muted)]">{ROLE_LABEL[user.role]}</p>
      </div>
      <Appearance />
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
