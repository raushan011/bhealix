"use client";

import { useRouter } from "next/navigation";

/**
 * Signing out from a server-rendered page. The shells have their own copy of
 * this inline; this is the standalone one, for pages that need the action
 * without the whole shell around it.
 */
export function SignOutButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return <button onClick={signOut} className={className}>{children}</button>;
}
