import { NextResponse } from "next/server";
import { ZodError } from "zod";
export function ok(data:unknown,status=200){return NextResponse.json({data},{status});}
export function fail(error:unknown){if(error instanceof ZodError)return NextResponse.json({error:"Validation failed",issues:error.issues},{status:400});if(error instanceof Error&&error.message.includes("duplicate key"))return NextResponse.json({error:"A matching record already exists"},{status:409});console.error(error);return NextResponse.json({error:"Internal server error"},{status:500});}
export function pageParams(url:string){const p=new URL(url).searchParams;const page=Math.max(1,Number(p.get("page"))||1);const limit=Math.min(100,Math.max(1,Number(p.get("limit"))||20));return {page,limit,skip:(page-1)*limit,q:(p.get("q")??"").trim()};}
