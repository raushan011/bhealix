import { connectDb } from "@/lib/db/mongoose";
import { SalesAutomationRule } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { ruleSchema } from "@/lib/sales/automation";

/** A new standing instruction. */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = ruleSchema.parse(await request.json());
    const rule = await SalesAutomationRule.create({ ...input, createdBy: auth.session.userId, updatedBy: auth.session.userId });

    await record({
      actor: auth.session.userId,
      action: "sales.automation.rule.created",
      entityType: "SalesAutomationRule",
      entityId: rule._id,
      metadata: { name: input.name, leadType: input.leadType, city: input.city, template: input.template.name }
    });

    return ok(rule, 201);
  } catch (error) {
    return fail(error);
  }
}
