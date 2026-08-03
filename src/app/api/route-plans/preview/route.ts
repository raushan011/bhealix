import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { fail,ok } from "@/lib/api";
import { nearestNeighborRoute } from "@/lib/routePlanning";

const schema=z.object({
  doctorIds:z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(2).max(50),
  referenceDoctorId:z.string().regex(/^[a-f\d]{24}$/i)
});

export async function POST(req:Request){
  try{
    await connectDb();
    const {doctorIds,referenceDoctorId}=schema.parse(await req.json());
    if(!doctorIds.includes(referenceDoctorId))return Response.json({error:"Reference doctor must be part of the selected doctor list"},{status:400});
    const docs=await Doctor.find({_id:{$in:doctorIds}}).select("name clinicName area city location").lean();
    if(docs.length!==doctorIds.length)return Response.json({error:"Some selected doctors could not be found"},{status:400});
    const withoutLocation=docs.filter(doctor=>!doctor.location?.coordinates);
    if(withoutLocation.length)return Response.json({error:`These doctors have no saved location: ${withoutLocation.map(doctor=>doctor.name).join(", ")}`},{status:400});
    const points=docs.map(doctor=>({id:String(doctor._id),latitude:doctor.location.coordinates[1],longitude:doctor.location.coordinates[0]}));
    const {stops,totalDistanceKm}=nearestNeighborRoute(referenceDoctorId,points);
    const byId=new Map(docs.map(doctor=>[String(doctor._id),doctor]));
    const ordered=stops.map((stop,index)=>({doctor:byId.get(stop.id),sequence:index+1,distanceFromPreviousKm:stop.distanceFromPreviousKm}));
    return ok({stops:ordered,totalDistanceKm});
  }catch(e){return fail(e)}
}
