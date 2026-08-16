import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Shown across the whole desk panel while a page is being fetched.
 *
 * One file at the top of the segment rather than one per screen: the shell —
 * sidebar, header, navigation — is already on the page and stays put, so all
 * this has to stand in for is the body, and the body of nearly every screen
 * here is a heading over a list. Screens whose shape is genuinely different can
 * add their own `loading.tsx` beside them, which takes precedence over this.
 */
export default function AdminLoading() {
  return <PageSkeleton />;
}
