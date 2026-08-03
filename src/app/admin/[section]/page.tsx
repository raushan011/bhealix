import Link from "next/link";
import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import type { Model } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { Assignment, Visit, FollowUp, Order, AuditEvent } from "@/models/CRM";
import { PageHeader } from "@/components/ui/page-header";
import { DataList } from "@/components/ui/data-list";

type Config={title:string;model:Model<unknown>;columns:Array<{key:string;label:string}>;base?:string};
const configs:Record<string,Config>={
  employees:{title:"Employees",model:User,base:"/admin/employees",columns:[{key:"name",label:"Employee"},{key:"employeeId",label:"ID"},{key:"email",label:"Email"},{key:"role",label:"Role"},{key:"active",label:"Active"}]},
  assignments:{title:"Assignments",model:Assignment,base:"/admin/assignments",columns:[{key:"doctor",label:"Doctor"},{key:"employee",label:"Employee"},{key:"date",label:"Date"},{key:"scheduledTime",label:"Time"},{key:"status",label:"Status"}]},
  visits:{title:"Visits",model:Visit,base:"/admin/visits",columns:[{key:"doctor",label:"Doctor"},{key:"employee",label:"Employee"},{key:"status",label:"Status"},{key:"outcome",label:"Outcome"},{key:"completedAt",label:"Completed"}]},
  "follow-ups":{title:"Follow-ups",model:FollowUp,base:"/admin/follow-ups",columns:[{key:"doctor",label:"Doctor"},{key:"employee",label:"Employee"},{key:"dueAt",label:"Due"},{key:"status",label:"Status"},{key:"note",label:"Note"}]},
  orders:{title:"Orders",model:Order,base:"/admin/orders",columns:[{key:"doctor",label:"Doctor"},{key:"employee",label:"Employee"},{key:"total",label:"Value"},{key:"status",label:"Status"},{key:"createdAt",label:"Created"}]},
  "audit-logs":{title:"Audit logs",model:AuditEvent,columns:[{key:"action",label:"Action"},{key:"entityType",label:"Entity"},{key:"actor",label:"Actor"},{key:"createdAt",label:"Date"}]}
};
export default async function Section({params,searchParams}:{params:Promise<{section:string}>;searchParams:Promise<{created?:string}>}){
  const {section}=await params;
  const created=(await searchParams).created==="1";
  if(["reports","settings","calendar","notifications"].includes(section))return <Info section={section}/>;
  const config=configs[section]; if(!config)notFound();
  await connectDb();
  const filter=section==="employees"?{active:{$ne:false}}:{};
  let query=config.model.find(filter).sort({createdAt:-1}).limit(50).select(section==="employees"?"-passwordHash":"");
  if(["assignments","visits","follow-ups","orders"].includes(section))query=query.populate([{path:"doctor",select:"name"},{path:"employee",select:"name"}]);
  const rows=await query.lean() as unknown as Array<Record<string,unknown>>;
  return <div className="space-y-6"><PageHeader title={config.title} subtitle={`${rows.length} recent records`} actions={config.base&&<Link href={`${config.base}/new`} className="tap inline-flex items-center gap-2 rounded-xl bg-[#173f3a] px-4 text-sm font-semibold text-white"><Plus size={17}/>Add</Link>}/>{created&&<div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Record created successfully.</div>}<DataList rows={rows} columns={config.columns} detailBase={config.base} resource={section==="audit-logs"?undefined:section}/></div>
}
function Info({section}:{section:string}){const copy:Record<string,[string,string]>={reports:["Reports","Performance and commercial reports update as activity is recorded."],settings:["Settings","Manage specialties, doctor types, territories, products and permissions."],calendar:["Calendar","Assignments and follow-ups are organised here by date."],notifications:["Notifications","Visit reminders, approvals and assignment updates appear here."]};const [title,description]=copy[section];return <div className="space-y-6"><PageHeader title={title}/><section className="surface p-6"><h2 className="font-semibold">{title}</h2><p className="mt-2 max-w-xl text-sm text-[#697572]">{description}</p></section></div>}
