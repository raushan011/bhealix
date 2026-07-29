import { cookies } from "next/headers";import { ok } from "@/lib/api";export async function POST(){(await cookies()).delete("bhealix_session");return ok({loggedOut:true})}
