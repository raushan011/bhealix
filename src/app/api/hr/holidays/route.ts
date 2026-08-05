import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Holiday } from "@/models/HR";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  date: z.string().regex(ISO_DATE, "Enter a valid date"),
  name: z.string().trim().min(2, "Name the holiday").max(120),
  note: z.string().trim().max(300).optional()
});

/** The company calendar. Everybody may read it; only HR may change it. */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const year = new URL(request.url).searchParams.get("year");
    const filter = year && /^\d{4}$/.test(year) ? { date: { $regex: `^${year}` } } : {};
    const items = await Holiday.find(filter).sort({ date: 1 }).limit(200).lean();
    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageAttendance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const value = schema.parse(await request.json());
    // Naming the same day twice is a correction, not a second holiday.
    const holiday = await Holiday.findOneAndUpdate(
      { date: value.date },
      { $set: { ...value, createdBy: auth.session.userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return ok(holiday, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await apiSession(can.manageAttendance);
    if ("response" in auth) return auth.response;
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!ISO_DATE.test(date)) return badRequest("Invalid date");

    await connectDb();
    await Holiday.deleteOne({ date });
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
