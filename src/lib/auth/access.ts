import { cache } from "react";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { isGrantable, type Workspace } from "@/lib/workspace";
import { mayEnter, panelsFor, type StoredGrant } from "./grants";
import type { Session } from "./session";

/**
 * Which CRMs an account may enter, read from the database rather than from the
 * session token.
 *
 * The token is the tempting place to keep this — it is already opened on every
 * request and costs nothing. It is also wrong. A session can live for weeks, so
 * a panel withdrawn at nine in the morning would go on working until nine at
 * night, and "I have taken that away from them" has to mean *now* or it is not
 * an access control, it is a suggestion.
 *
 * The read is memoised for the life of one request instead, so a page whose
 * layout, nested layout and shell all ask the question makes one query between
 * them. `cache` is React's per-request memo and is emptied between requests,
 * which is exactly the lifetime wanted: fresh for every navigation, shared
 * within one.
 */

export type { StoredGrant } from "./grants";

/** The decision recorded against one account, or nothing if none has been. */
export const storedGrantFor = cache(async (userId: string): Promise<StoredGrant> => {
  await connectDb();
  const user = await User.findById(userId).select("workspaces").lean() as { workspaces?: unknown } | null;
  return Array.isArray(user?.workspaces) ? user.workspaces.filter(isGrantable) : undefined;
});

/** The panels the signed-in account can open, ready for a sidebar or a chooser. */
export async function panelsForSession(session: Session): Promise<Workspace[]> {
  return panelsFor(session.role, await storedGrantFor(session.userId));
}

/** Whether the signed-in account may open one panel. */
export async function sessionMayEnter(session: Session, workspace: Workspace): Promise<boolean> {
  return mayEnter(session.role, await storedGrantFor(session.userId), workspace);
}
