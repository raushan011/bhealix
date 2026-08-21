import { connectDb } from "@/lib/db/mongoose";
import { DemoLead } from "@/models/DemoLead";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams } from "@/lib/api";
import { DEMO_LEAD_STATUSES } from "@/lib/demo-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every demo request, newest first, with the count behind each status chip. */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.manageDemoLeads);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const status = params.get("status");

    // The search alone, and the search with the status: the chips are counted
    // against the first so each says what it would show if tapped.
    const search: Record<string, unknown> = {};
    if (q) {
      const safe = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      search.$or = [{ name: safe }, { company: safe }, { email: safe }, { phone: safe }];
    }
    const filter = status && (DEMO_LEAD_STATUSES as readonly string[]).includes(status) ? { ...search, status } : search;

    const [items, total, byStatus] = await Promise.all([
      DemoLead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      DemoLead.countDocuments(filter),
      DemoLead.aggregate<{ _id: string; count: number }>([
        { $match: search },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ])
    ]);

    const statuses = Object.fromEntries(DEMO_LEAD_STATUSES.map(value => [value, 0])) as Record<string, number>;
    for (const row of byStatus) if (row._id in statuses) statuses[row._id] = row.count;

    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)), statuses });
  } catch (error) {
    return fail(error);
  }
}
