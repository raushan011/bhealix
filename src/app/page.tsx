import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { landingFor } from "@/constants/access";
import { LandingPage } from "@/components/marketing/landing";

export const metadata: Metadata = {
  title: "BHEALIX CRM — field sales, online sales and the back office in one system",
  description: "Plan field visits around each clinic's call hours, sync Shopify orders and pay affiliate commissions on delivery, ring every customer back, and raise GST invoices and payslips — from one system built for Indian business."
};

/**
 * Somebody signed in is sent to their panel; everybody else sees the product.
 * The chooser and the field panel are one redirect away, so a bookmark on the
 * root keeps working for staff exactly as it did when this was only a redirect.
 */
export default async function Home() {
  const session = await getSession();
  if (session) redirect(landingFor(session.role));
  return <LandingPage />;
}
