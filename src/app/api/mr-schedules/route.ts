import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { MrCallSchedule } from "@/models/Catalog";
import { fail,ok } from "@/lib/api";

const schema=z.object({
  doctor:z.string().regex(/^[a-f\d]{24}$/i),
  weekday:z.number().int().min(0).max(6),
  start:z.string().min(1),
  end:z.string().min(1),
  appointmentRequired:z.boolean().default(false),
  instructions:z.string().max(500).default("")
});

export async function GET(req:Request){
  try{
    await connectDb();
    const doctorId=new URL(req.url).searchParams.get("doctor");
    if(!doctorId)return Response.json({error:"doctor is required"},{status:400});
    const items=await MrCallSchedule.find({doctor:doctorId}).sort({weekday:1}).lean();
    return ok({items});
  }catch(e){return fail(e)}
}

export async function POST(req:Request){
  try{
    await connectDb();
    const value=schema.parse(await req.json());
    const schedule=await MrCallSchedule.findOneAndUpdate(
      {doctor:value.doctor,clinic:null,weekday:value.weekday},
      {$set:{allowed:true,appointmentRequired:value.appointmentRequired,instructions:value.instructions,lastVerifiedAt:new Date()},$push:{slots:{start:value.start,end:value.end}}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
    return ok(schedule,201);
  }catch(e){return fail(e)}
}
