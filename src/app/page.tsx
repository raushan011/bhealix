import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { landingFor } from "@/constants/access";

export default async function Home() {
  const session = await getSession();
  redirect(session ? landingFor(session.role) : "/login");
}
