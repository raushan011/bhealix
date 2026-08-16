import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * The field panel's stand-in while a screen loads.
 *
 * Fewer rows than the desk's, because this is read on a phone and only about
 * that many fit above the fold — drawing a skeleton for rows nobody can see
 * just animates off-screen. It matters more here than anywhere else in the app:
 * a rep opening this on mobile data in a corridor is the slowest connection the
 * application has, and the one most likely to be tapped twice.
 */
export default function EmployeeLoading() {
  return <PageSkeleton rows={4} />;
}
