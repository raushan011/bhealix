import { AdminShell } from "@/components/layout/admin-shell";
import { requireAuth } from "@/lib/auth/authorize";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";

export default async function Layout({children}:{children:React.ReactNode}) {
  const session=await requireAuth();
  await connectDb();
  const user=await User.findById(session.userId).select("name role").lean() as {name:string;role:string}|null;
  return <AdminShell user={{name:user?.name??"Admin",role:session.role}}>{children}</AdminShell>;
}
