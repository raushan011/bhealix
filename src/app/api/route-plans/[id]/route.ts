import { getSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/CRM";
import { fail,ok } from "@/lib/api";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const session=await getSession();
    if(!session)return Response.json({error:"Unauthenticated"},{status:401});
    await connectDb();
    const {id}=await params;
    const plan=await RoutePlan.findById(id).populate("referenceDoctor","name area city").populate("assignedTo","name employeeId").populate("stops.doctor","name clinicName area city phones location").lean() as {assignedTo?:{_id:unknown}|null}|null;
    if(!plan)return Response.json({error:"Not found"},{status:404});
    if(session.role!=="ADMIN"&&String(plan.assignedTo?._id??plan.assignedTo??"")!==session.userId)return Response.json({error:"Forbidden"},{status:403});
    return ok(plan);
  }catch(e){return fail(e)}
}

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const session=await getSession();
    if(!session)return Response.json({error:"Unauthenticated"},{status:401});
    await connectDb();
    const {id}=await params;
    const body=await req.json() as {status?:string;assignedTo?:string};
    const plan=await RoutePlan.findById(id);
    if(!plan)return Response.json({error:"Not found"},{status:404});
    if(session.role!=="ADMIN"&&String(plan.assignedTo)!==session.userId)return Response.json({error:"Forbidden"},{status:403});
    if(body.status&&["Draft","Assigned","Completed"].includes(body.status))plan.status=body.status;
    if(body.assignedTo&&session.role==="ADMIN")plan.assignedTo=body.assignedTo;
    await plan.save();
    return ok(plan);
  }catch(e){return fail(e)}
}

export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const session=await getSession();
    if(!session||session.role!=="ADMIN")return Response.json({error:"Forbidden"},{status:403});
    await connectDb();
    const {id}=await params;
    const plan=await RoutePlan.findByIdAndDelete(id);
    return plan?ok(plan):Response.json({error:"Not found"},{status:404});
  }catch(e){return fail(e)}
}
