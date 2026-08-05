import { InvoiceView } from "@/components/billing/invoice-view";

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceView invoiceId={id} backHref="/admin/billing" />;
}
