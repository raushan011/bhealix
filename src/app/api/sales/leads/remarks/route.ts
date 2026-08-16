import type { PipelineStage } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams } from "@/lib/api";
import { REMARK_PROJECTION, REMARK_SORT, remarkStages } from "@/lib/sales/remark-log";

/**
 * Every remark, newest first — the log somebody reads on a Friday to see what
 * the week's calling actually produced.
 *
 * A sibling of `[id]` rather than under it, the way `search` already is: Next
 * matches a literal segment ahead of a dynamic one, so `/leads/remarks` lands
 * here and `/leads/<id>/remarks` lands on the thread.
 *
 * `viewSales` rather than `manageSales`. Reading what was said to whom is the
 * same permission as reading the list itself; only writing a remark needs more.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const { stages, channel } = remarkStages(params);

    const [result] = await SalesLead.aggregate([
      ...stages,
      {
        $facet: {
          items: [...channel, { $sort: REMARK_SORT }, { $skip: skip }, { $limit: limit }, { $project: REMARK_PROJECTION }],
          total: [...channel, { $count: "value" }],
          // Counted before the channel narrowing, so the filter can be labelled
          // with what is actually there rather than zeroes.
          channels: [{ $group: { _id: "$remarks.channel", count: { $sum: 1 } } }],
          // What the log is filtered by on the screen next to it. Taken from the
          // leads that have remarks at all, so the dropdown never offers a trade
          // whose every row would come back empty.
          types: [{ $group: { _id: "$type" } }, { $sort: { _id: 1 } }]
        }
      }
      // The stages are built as plain objects in a module that deliberately
      // knows nothing about mongoose, so the shape is asserted here rather than
      // dragging the driver's types into it.
    ] as unknown as PipelineStage[]);

    const total = (result?.total?.[0]?.value as number) ?? 0;

    return ok({
      items: result?.items ?? [],
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      counts: Object.fromEntries(
        (result?.channels ?? []).map((row: { _id: string; count: number }) => [row._id, row.count])
      ),
      types: (result?.types ?? []).map((row: { _id: string }) => row._id).filter(Boolean)
    });
  } catch (error) {
    return fail(error);
  }
}
