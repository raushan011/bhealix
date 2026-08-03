import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function fail(error: unknown) {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const field = first?.path.join(".");
    return NextResponse.json({ error: field ? `${field}: ${first.message}` : first?.message ?? "Invalid request" }, { status: 400 });
  }
  if (error instanceof Error && error.message.includes("duplicate key")) {
    return NextResponse.json({ error: "A matching record already exists" }, { status: 409 });
  }
  console.error(error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export function pageParams(url: string) {
  const params = new URL(url).searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 20));
  return { page, limit, skip: (page - 1) * limit, q: (params.get("q") ?? "").trim() };
}

export const OBJECT_ID = /^[a-f\d]{24}$/i;
