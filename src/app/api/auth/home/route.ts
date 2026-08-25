import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { fail, ok } from "@/lib/api";

const homeSchema = z.object({
  address: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

/**
 * Saves where a person's day starts when they plan a round from home.
 *
 * Self-service and needs no capability check: this is a home address, not a
 * record anybody else's work depends on, so being signed in is the only bar —
 * the same one that lets somebody change their own password.
 */
export async function PUT(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { address, latitude, longitude } = homeSchema.parse(await request.json());
    const user = await User.findByIdAndUpdate(auth.session.userId, {
      homeAddress: address || undefined,
      homeLocation: { type: "Point", coordinates: [longitude, latitude] }
    }, { new: true }).select("homeAddress homeLocation");
    if (!user) return Response.json({ error: "Account not found" }, { status: 404 });
    return ok(user);
  } catch (error) {
    return fail(error);
  }
}
