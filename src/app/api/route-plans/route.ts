import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { Assignment,RoutePlan } from "@/models/CRM";
import { fail,ok,pageParams } from "@/lib/api";
import { nearestNeighborRoute } from "@/lib/routePlanning";

const schema=z.object({
  name:z.string().min(2),
  date:z.coerce.date(),
  referenceDoctorId:z.string().regex(/^[a-f\d]{24}$/i),
  doctorIds:z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(2).max(50),
  assignedTo:z.string().regex(/^[a-f\d]{24}$/i).optional(),
  startTime:z.string().regex(/^\d{2}:\d{2}$/).default("10:00"),
  visitMinutes:z.number().int().min(10).max(240).default(45)
});

export async function GET(req:Request){
  try{
    const session=await getSession();
    if(!session)return Response.json({error:"Unauthenticated"},{status:401});
    await connectDb();
    const {page,limit,skip}=pageParams(req.url);
    const filter=session.role==="ADMIN"?{}:{assignedTo:session.userId};
    const [items,total]=await Promise.all([
      RoutePlan.find(filter).populate("referenceDoctor","name area city").populate("assignedTo","name employeeId").populate("stops.doctor","name clinicName area city phones").sort({date:-1}).skip(skip).limit(limit).lean(),
      RoutePlan.countDocuments(filter)
    ]);
    return ok({items,total,page,pages:Math.ceil(total/limit)});
  }catch(e){return fail(e)}
}

export async function POST(req:Request){
  try{
    const session=await getSession();
    if(!session)return Response.json({error:"Unauthenticated"},{status:401});
    await connectDb();
    const value=schema.parse(await req.json());
    if(!value.doctorIds.includes(value.referenceDoctorId))return Response.json({error:"Reference doctor must be part of the selected doctor list"},{status:400});
    const docs=await Doctor.find({_id:{$in:value.doctorIds}}).select("name location").lean();
    if(docs.length!==value.doctorIds.length)return Response.json({error:"Some selected doctors could not be found"},{status:400});
    const withoutLocation=docs.filter(doctor=>!doctor.location?.coordinates);
    if(withoutLocation.length)return Response.json({error:`These doctors have no saved location: ${withoutLocation.map(doctor=>doctor.name).join(", ")}`},{status:400});
    const points=docs.map(doctor=>({id:String(doctor._id),latitude:doctor.location.coordinates[1],longitude:doctor.location.coordinates[0]}));
    const {stops,totalDistanceKm}=nearestNeighborRoute(value.referenceDoctorId,points);
    const plan=await RoutePlan.create({
      name:value.name,
      date:value.date,
      referenceDoctor:value.referenceDoctorId,
      stops:stops.map((stop,index)=>({doctor:stop.id,sequence:index+1,distanceFromPreviousKm:stop.distanceFromPreviousKm})),
      totalDistanceKm,
      assignedTo:value.assignedTo,
      createdBy:session.userId,
      status:value.assignedTo?"Assigned":"Draft"
    });
    if(value.assignedTo){
      const start=new Date(value.date);start.setHours(0,0,0,0);
      const [startHour,startMinute]=value.startTime.split(":").map(Number);
      let minutes=startHour*60+startMinute;
      for(const stop of stops){
        const time=`${String(Math.floor(minutes/60)%24).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;
        await Assignment.findOneAndUpdate(
          {doctor:stop.id,employee:value.assignedTo,date:start},
          {$setOnInsert:{status:"Scheduled",recurrence:"None",createdBy:session.userId},$set:{scheduledTime:time}},
          {upsert:true}
        );
        minutes+=value.visitMinutes;
      }
    }
    return ok(plan,201);
  }catch(e){return fail(e)}
}
