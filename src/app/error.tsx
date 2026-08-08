"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/kit";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="grid min-h-[100dvh] place-items-center px-5 text-center">
    <div>
      <TriangleAlert size={32} className="mx-auto text-[var(--warn-ink)]" />
      <h1 className="mt-4 text-xl">Something went wrong</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Check your connection and try again.</p>
      <div className="mt-6 flex justify-center"><Button onClick={reset}>Try again</Button></div>
    </div>
  </main>;
}
