import * as XLSX from "xlsx";
import { connectDb } from "@/lib/db/mongoose";
import { SalesShopOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail } from "@/lib/api";
import { shopOrderFilter, shopOrderSort } from "@/lib/sales/retarget";

/** How many orders one download carries. Larger than the shop's whole history so far. */
const LIMIT = 20000;

type Row = {
  name: string; placedAt: Date; total: number; paymentMethod?: string; fulfilment?: string; cancelledAt?: Date | null;
  customer?: { name?: string; phone?: string; email?: string; city?: string; state?: string; pinCode?: string; address1?: string };
  customerOrders?: number; items?: { title: string; quantity: number }[]; discountCodes?: string[]; couponCode?: string | null;
  rep?: { name?: string; code?: string } | null;
  delivery?: { state?: string; courier?: string; deliveredAt?: Date };
  retarget?: {
    status?: string; phone?: string; notes?: string; contactCount?: number; lastContactedAt?: Date; nextFollowUpAt?: Date;
    remarks?: { text: string; channel: string; status?: string; at: Date; byName?: string }[];
  };
};

const stamp = (value?: Date | null) => value ? new Date(value).toLocaleString("en-IN", { hour12: false }) : "";
const day = (value?: Date | null) => value ? new Date(value).toLocaleDateString("en-IN") : "";

/**
 * The list as a spreadsheet, filtered exactly as the screen was.
 *
 * Two sheets: the orders, one row each with the last remark on it, and every
 * remark ever written against them — a week of calling in a file that can be
 * handed to somebody without a login.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const filter = shopOrderFilter(params);
    const orders = await SalesShopOrder.find(filter).sort(shopOrderSort(params.get("sort"))).limit(LIMIT)
      .populate("rep", "name code").lean() as unknown as Row[];

    const rows = orders.map(order => {
      const latest = [...(order.retarget?.remarks ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
      return {
        "Order": order.name,
        "Placed on": day(order.placedAt),
        "Customer": order.customer?.name ?? "",
        "Phone": order.retarget?.phone || order.customer?.phone || "",
        "Email": order.customer?.email ?? "",
        "City": order.customer?.city ?? "",
        "State": order.customer?.state ?? "",
        "Pin code": order.customer?.pinCode ?? "",
        "Items": (order.items ?? []).map(item => `${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join(", "),
        "Amount": order.total,
        "Payment": order.paymentMethod ?? "",
        "Shopify fulfilment": order.fulfilment ?? "",
        "Delivery": order.delivery?.state ?? "",
        "Delivered on": day(order.delivery?.deliveredAt),
        "Cancelled": order.cancelledAt ? "Yes" : "",
        "Orders by this customer": order.customerOrders ?? 1,
        "Coupon": order.couponCode ?? (order.discountCodes ?? []).join(", "),
        "Partner": order.rep?.name ? `${order.rep.name} (${order.rep.code ?? ""})` : "",
        "Calling status": order.retarget?.status ?? "Not called",
        "Times contacted": order.retarget?.contactCount ?? 0,
        "Last contacted": stamp(order.retarget?.lastContactedAt),
        "Next follow-up": day(order.retarget?.nextFollowUpAt),
        "Remarks": order.retarget?.remarks?.length ?? 0,
        "Last remark": latest?.text ?? "",
        "Last remark on": stamp(latest?.at),
        "Last remark by": latest?.byName ?? "",
        "Notes": order.retarget?.notes ?? ""
      };
    });

    const remarks = orders.flatMap(order => (order.retarget?.remarks ?? []).map(remark => ({
      "When": stamp(remark.at),
      "Order": order.name,
      "Customer": order.customer?.name ?? "",
      "Phone": order.retarget?.phone || order.customer?.phone || "",
      "Channel": remark.channel,
      "Remark": remark.text,
      "Moved to": remark.status ?? "",
      "Status now": order.retarget?.status ?? "",
      "By": remark.byName ?? ""
    }))).sort((a, b) => b.When.localeCompare(a.When));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Nothing matched these filters": "" }]), "Orders");
    if (remarks.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(remarks), "Remarks");

    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename=bhealix-retarget-${new Date().toISOString().slice(0, 10)}.xlsx`
      }
    });
  } catch (error) {
    return fail(error);
  }
}
