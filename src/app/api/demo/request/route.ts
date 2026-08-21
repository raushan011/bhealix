import { connectDb } from "@/lib/db/mongoose";
import { DemoLead } from "@/models/DemoLead";
import { fail, ok } from "@/lib/api";
import { callerKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { demoRequestSchema } from "@/lib/demo-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Book a demo", from the public site.
 *
 * The one endpoint a stranger can write to, so it is held to three things: a
 * rate limit per caller, the schema, and a honeypot. It grants nothing and
 * reads nothing back — the reply is the same whether the row was kept or the
 * honeypot ate it, because a robot told apart is a robot that adapts.
 */
export async function POST(request: Request) {
  try {
    const limit = rateLimit(callerKey(request, "demo-request"), 5, 60 * 60 * 1000);
    if (!limit.ok) return tooManyRequests(limit.retryAfter, "Too many requests from here. Please try again in a little while.");

    const input = demoRequestSchema.parse(await request.json());
    if (input.website) return ok({ received: true }, 201);

    await connectDb();
    await DemoLead.create({
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      role: input.role || undefined,
      teamSize: input.teamSize || undefined,
      interests: input.interests,
      message: input.message || undefined,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) || undefined
    });

    return ok({ received: true }, 201);
  } catch (error) {
    return fail(error);
  }
}
