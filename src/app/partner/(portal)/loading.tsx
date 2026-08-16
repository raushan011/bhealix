import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * The affiliate portal's stand-in.
 *
 * Every screen behind this layout waits on `requirePartner`, which reloads the
 * rep from the database on each request rather than trusting the cookie — the
 * right call for a suspension to bite immediately, but it does mean there is
 * always a query between the tap and the page.
 */
export default function PartnerPortalLoading() {
  return <PageSkeleton rows={4} />;
}
