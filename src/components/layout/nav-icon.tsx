"use client";

import { useLinkStatus } from "next/link";
import { Loader2, type LucideIcon } from "lucide-react";

/**
 * A navigation item's icon, which turns into a spinner while that item is the
 * one being waited for.
 *
 * The bar along the top says *something* is loading; this says *which* — the
 * tapped item answers for itself, so there is no doubt about whether the press
 * landed on Doctors or on Plans beside it. On a phone, where the finger covers
 * the tab it just hit, that distinction is most of the reassurance.
 *
 * `useLinkStatus` reads the pending state of the enclosing `<Link>`, so this
 * only works rendered as a child of one, and it reports nothing for a route
 * already prefetched — which is correct. An instant navigation should not flash
 * a spinner on its way past.
 */
export function NavIcon({ icon: Icon, size = 18, className = "" }: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  return pending
    ? <Loader2 size={size} className={`shrink-0 animate-spin ${className}`} />
    : <Icon size={size} className={`shrink-0 ${className}`} />;
}
