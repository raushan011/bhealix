import { UserManager } from "@/components/control/user-manager";
import { requireSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requireSession();
  return <UserManager selfId={session.userId} />;
}
