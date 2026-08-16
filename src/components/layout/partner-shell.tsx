"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, LogOut, ShoppingBag, Tag, Wallet } from "lucide-react";
import { NavIcon } from "@/components/layout/nav-icon";
import { BrandMark } from "@/components/ui/brand";
import { Appearance } from "@/components/ui/appearance";

/**
 * The affiliate's own panel.
 *
 * Four tabs, phone-first, and shaped after the field shell next door rather than
 * the admin sidebar — an affiliate is a beautician with a phone behind a
 * counter, not somebody at a desk. The tab bar clears the iOS home indicator for
 * the same reason it does there.
 *
 * It is a separate component from `FieldShell` despite the resemblance, because
 * the two answer to different people. A change to the employee tabs is a change
 * to what staff do all day; a change here is visible to everybody outside the
 * company who sells for it. Sharing the component would have meant every future
 * edit to one being a decision about the other.
 */
const TABS = [
  { href: "/partner", label: "Home", icon: LayoutGrid },
  { href: "/partner/coupons", label: "My codes", icon: Tag },
  { href: "/partner/orders", label: "Orders", icon: ShoppingBag },
  { href: "/partner/payouts", label: "Payments", icon: Wallet }
] as const;

const isActive = (pathname: string, href: string) =>
  href === "/partner" ? pathname === "/partner" : pathname.startsWith(href);

export function PartnerShell({ rep, children }: {
  rep: { name: string; code: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/partner/logout", { method: "POST" });
    router.replace("/partner/login");
    router.refresh();
  }

  return <div className="min-h-[100dvh] pb-[calc(68px+env(safe-area-inset-bottom))]">
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--surface-veil)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <Link href="/partner/profile" className="flex min-w-0 items-center gap-2.5">
          <BrandMark size={30} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight">{rep.name}</span>
            {/* Their rep code, because it is the front half of every coupon they
                hold and the thing they get asked for on the telephone. */}
            <span className="block truncate text-[11px] text-[var(--muted)]">{rep.code}</span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center">
          <Appearance />
          <button onClick={signOut} aria-label="Sign out"
            className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>

    <main key={pathname} className="page-enter mx-auto w-full max-w-2xl px-4 py-5">{children}</main>

    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid h-[68px] max-w-2xl grid-cols-4">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}>
            <NavIcon icon={Icon} size={21} /><span className="w-full truncate text-center">{label}</span>
          </Link>;
        })}
      </div>
    </nav>
  </div>;
}
