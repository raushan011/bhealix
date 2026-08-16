import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can, ROLE_LABEL, usesAdminPanel, type Role } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { grantedWorkspaces } from "@/lib/auth/grants";
import { GRANTABLE_WORKSPACES, isGrantable, WORKSPACE_LABEL, type GrantableWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { _id: unknown; name: string; email: string; employeeId: string; role: Role; active?: boolean; workspaces?: unknown; designation?: string };

const toAccount = (row: Row, self: string) => ({
  id: String(row._id),
  name: row.name,
  email: row.email,
  employeeId: row.employeeId,
  role: row.role,
  roleLabel: ROLE_LABEL[row.role],
  designation: row.designation,
  active: row.active !== false,
  /** What is in force, whether or not anybody has decided it. */
  workspaces: grantedWorkspaces(row.role, Array.isArray(row.workspaces) ? row.workspaces.filter(isGrantable) : undefined),
  /**
   * Whether the list above was decided or inherited. Worth telling apart on
   * screen: "this is what their role has always had" and "somebody sat down and
   * chose this" look identical otherwise, and only one of them is a decision
   * anybody should feel free to reverse.
   */
  decided: Array.isArray(row.workspaces),
  /**
   * A super administrator holds every panel by role and cannot be locked out of
   * their own access screen — including by themselves, which is the accident
   * this is really guarding against.
   */
  locked: row.role === "SUPERADMIN",
  self: String(row._id) === self
});

/**
 * Everybody who works at a desk, and what they can open.
 *
 * Field staff are deliberately absent. A medical representative has one panel,
 * reached from a phone, and it is not one of the two on offer here — listing
 * them would be listing thirty people with nothing to decide about them, and
 * would invite somebody to withdraw a "panel" a rep never had.
 */
export async function GET() {
  try {
    const auth = await apiSession(can.manageAccess);
    if ("response" in auth) return auth.response;
    await connectDb();

    const rows = await User.find({ role: { $in: ["SUPERADMIN", "ADMIN", "HR"] } })
      .select("name email employeeId role active workspaces designation")
      .sort({ role: 1, name: 1 })
      .lean() as unknown as Row[];

    return ok({
      accounts: rows.map(row => toAccount(row, auth.session.userId)),
      workspaces: GRANTABLE_WORKSPACES.map(key => ({ key, label: WORKSPACE_LABEL[key] }))
    });
  } catch (error) {
    return fail(error);
  }
}

const schema = z.object({
  userId: z.string().regex(OBJECT_ID, "Choose an account"),
  workspaces: z.array(z.string()).max(GRANTABLE_WORKSPACES.length)
});

/**
 * Grants, revised.
 *
 * The whole array is sent rather than a delta, because that is what the screen
 * actually holds — a row of switches — and a delta would let two people editing
 * the same account at once produce a state neither of them chose.
 *
 * Three things are refused outright, and each is a way the screen could
 * otherwise be used to break itself:
 *
 * 1. **The super admin panel is not on the list.** It is not grantable, so it
 *    cannot arrive here even in a hand-written request.
 * 2. **A super administrator's own panels cannot be trimmed.** Their access is a
 *    property of the role; recording an empty array against one would produce an
 *    account that holds the control panel and neither CRM, which is a state with
 *    no way back through the interface.
 * 3. **Field roles are not addressable.** Their panel is not one of these.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await apiSession(can.manageAccess);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const chosen = [...new Set(input.workspaces.filter(isGrantable))] as GrantableWorkspace[];
    if (chosen.length !== input.workspaces.length) {
      return badRequest("Only the Doctor CRM and the Sales CRM can be granted from here.");
    }

    const target = await User.findById(input.userId)
      .select("name email employeeId role active workspaces designation")
      .lean() as Row | null;

    if (!target) return badRequest("That account no longer exists", 404);
    if (target.role === "SUPERADMIN") return badRequest("A super administrator holds every panel by their role, and it cannot be withdrawn here.");
    if (!usesAdminPanel(target.role)) return badRequest(`${ROLE_LABEL[target.role]}s work from the field panel, which is not granted from here.`);

    const before = grantedWorkspaces(target.role, Array.isArray(target.workspaces) ? target.workspaces.filter(isGrantable) : undefined);
    const after = GRANTABLE_WORKSPACES.filter(workspace => chosen.includes(workspace));

    await User.updateOne({ _id: input.userId }, { $set: { workspaces: after } });

    /*
     * Both sides of the change go into the trail, not just the new state. "Who
     * took my Sales CRM away" is answered by the difference; a line recording
     * only what somebody now holds cannot say whether anything changed at all,
     * and a grant edited twice would read as one edit.
     */
    await record({
      actor: auth.session.userId,
      action: "access.workspaces.granted",
      entityType: "User",
      entityId: input.userId,
      metadata: { name: target.name, email: target.email, role: target.role, before, after }
    });

    return ok({
      account: toAccount({ ...target, workspaces: after }, auth.session.userId),
      message: after.length
        ? `${target.name} can now open ${after.map(key => WORKSPACE_LABEL[key]).join(" and ")}.`
        : `${target.name} can no longer open either CRM. They can still sign in, and will be told to ask for access.`
    });
  } catch (error) {
    return fail(error);
  }
}
