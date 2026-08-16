import * as XLSX from "xlsx";
import type { PipelineStage } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail } from "@/lib/api";
import { leadWhere, withLeadStatus } from "@/lib/sales/leads";
import { REMARK_EXPORT_LIMIT, REMARK_PROJECTION, REMARK_SORT, remarkStages } from "@/lib/sales/remark-log";

/** How many leads one download carries. Larger than any sweep anybody has run. */
const LEAD_LIMIT = 20000;

type LeadRow = {
  name: string; type: string; status: string; phone?: string; website?: string;
  address?: string; area?: string; city?: string; rating?: number; reviewCount?: number;
  source?: string; notes?: string; googleMapsUrl?: string;
  contactCount?: number; lastContactedAt?: Date; createdAt?: Date;
  remarks?: { text: string; channel: string; at: Date; byName?: string }[];
};

type RemarkRow = {
  text: string; channel: string; status?: string; at: Date; byName?: string;
  lead: { name: string; type: string; status: string; phone?: string; area?: string; city?: string };
};

/** A moment as a spreadsheet should carry it: readable, and sortable as text. */
const stamp = (value?: Date | null) =>
  value ? new Date(value).toLocaleString("en-IN", { hour12: false }) : "";

const day = (value?: Date | null) =>
  value ? new Date(value).toLocaleDateString("en-IN") : "";

/**
 * The list, and everything said to it, as a spreadsheet.
 *
 * Filtered by whatever the screen was filtered by — the parameters are read
 * through the same `leadWhere` the list itself uses, so a download taken from a
 * screen showing "Beauty parlour, Contacted" is those rows and no others. A
 * download that quietly carries more than the screen it was pressed from is
 * worse than no download, because it is a spreadsheet somebody makes decisions
 * on without ever re-checking what is in it.
 *
 * Two sheets rather than two downloads. The remarks are the reason anybody
 * exports this — a week of calling, in a file that can be sent to somebody who
 * has no login — and the leads sheet beside them is what makes a remark row
 * mean anything.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const scope = params.get("scope") ?? "both";
    const where = withLeadStatus(leadWhere(params), params.get("status"));

    const book = XLSX.utils.book_new();

    if (scope !== "remarks") {
      const leads = await SalesLead.find(where)
        .sort({ createdAt: -1 }).limit(LEAD_LIMIT).lean() as unknown as LeadRow[];

      const rows = leads.map(lead => {
        // Newest first, so "Last remark" is the one that decides what happens
        // next rather than whichever was written down first.
        const latest = [...(lead.remarks ?? [])]
          .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];

        return {
          "Business": lead.name,
          "Type": lead.type,
          "Status": lead.status,
          "Phone": lead.phone ?? "",
          "Address": lead.address ?? "",
          "Area": lead.area ?? "",
          "City": lead.city ?? "",
          "Rating": lead.rating ?? "",
          "Reviews": lead.reviewCount ?? "",
          "Remarks": lead.remarks?.length ?? 0,
          "Last remark": latest?.text ?? "",
          "Last remark on": stamp(latest?.at),
          "Last remark by": latest?.byName ?? "",
          "Times contacted": lead.contactCount ?? 0,
          "Last contacted": stamp(lead.lastContactedAt),
          "Notes": lead.notes ?? "",
          "Source": lead.source ?? "",
          "Website": lead.website ?? "",
          "Google Maps": lead.googleMapsUrl ?? "",
          "Saved on": day(lead.createdAt)
        };
      });

      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Leads");
    }

    if (scope !== "leads") {
      const { stages, channel } = remarkStages(params);
      const remarks = await SalesLead.aggregate([
        ...stages, ...channel,
        { $sort: REMARK_SORT },
        { $limit: REMARK_EXPORT_LIMIT },
        { $project: REMARK_PROJECTION }
      ] as unknown as PipelineStage[]) as RemarkRow[];

      const rows = remarks.map(row => ({
        "When": stamp(row.at),
        "Business": row.lead.name,
        "Type": row.lead.type,
        "Phone": row.lead.phone ?? "",
        "Area": row.lead.area ?? "",
        "City": row.lead.city ?? "",
        "Channel": row.channel,
        "Remark": row.text,
        "Moved to": row.status ?? "",
        "Lead status now": row.lead.status,
        "By": row.byName ?? ""
      }));

      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Remarks");
    }

    // An empty workbook is not a file any spreadsheet will open, and the
    // download would fail with no explanation at all.
    if (!book.SheetNames.length) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ "Nothing matched these filters": "" }]), "Leads");
    }

    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const name = scope === "remarks" ? "lead-remarks" : "leads";

    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename=bhealix-${name}-${new Date().toISOString().slice(0, 10)}.xlsx`
      }
    });
  } catch (error) {
    return fail(error);
  }
}
