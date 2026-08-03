import { SearchX } from "lucide-react";
import { LinkButton } from "@/components/ui/kit";

export default function NotFound() {
  return <main className="grid min-h-[100dvh] place-items-center px-5 text-center">
    <div>
      <SearchX size={34} className="mx-auto text-[var(--line-2)]" />
      <h1 className="mt-4 text-xl">Page not found</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">This page may have moved or never existed.</p>
      <div className="mt-6 flex justify-center"><LinkButton href="/">Back to the app</LinkButton></div>
    </div>
  </main>;
}
