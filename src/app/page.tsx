import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { homeFor } from "@/constants/access";

export default async function Home() {
  const session = await getSession();
  redirect(session ? homeFor(session.role) : "/login");
}
