import type { FilterQuery } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { apiSession } from "@/lib/auth/guard";
import { usesFieldPanel } from "@/constants/access";
import { fail, ok, pageParams } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const filter: FilterQuery<Record<string, unknown>> = {};

    // A rep can never widen this to somebody else's visits.
    if (usesFieldPanel(auth.session.role)) filter.employee = auth.session.userId;
    else if (params.get("employee")) filter.employee = params.get("employee");

    if (params.get("doctor")) filter.doctor = params.get("doctor");
    if (params.get("status")) filter.status = params.get("status");

    const from = params.get("from"), to = params.get("to");
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = new Date(`${from}T00:00:00`);
      if (to) range.$lte = new Date(`${to}T23:59:59`);
      filter.plannedDate = range;
    }

    const [items, total] = await Promise.all([
      Visit.find(filter)
        .populate("doctor", "name clinicName area city phones")
        .populate("employee", "name employeeId")
        .sort({ plannedDate: -1, plannedStart: 1 })
        .skip(skip).limit(limit).lean(),
      Visit.countDocuments(filter)
    ]);
    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    return fail(error);
  }
}
