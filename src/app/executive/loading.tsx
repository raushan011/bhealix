import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Shown across the executive's panel while a page is being fetched, so a tap on
 * the bottom bar answers at once instead of leaving the old screen frozen until
 * the new one arrives. The shell stays on screen; only the body is stood in for.
 */
export default function ExecutiveLoading() {
  return <PageSkeleton />;
}
