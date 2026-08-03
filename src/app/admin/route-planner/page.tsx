"use client";

import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import { CalendarDays,Check,Clock3,ExternalLink,Loader2,MapPin,Navigation,Pencil,Route,Save,Target,Trash2,Upload,Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { DoctorSearchInput,doctorPlace,type DoctorSuggestion } from "@/components/ui/doctor-search-input";
import { excelRowToExternalDoctor,externalDoctorToPayload } from "@/lib/doctors/search";

type Employee={_id:string;name:string;employeeId:string;role:string};
type PreviewStop={doctor:DoctorSuggestion;sequence:number;distanceFromPreviousKm:number};
type SavedPlan={_id:string;name:string;date:string;status:string;totalDistanceKm:number;assignedTo?:{name?:string};stops:Array<{doctor?:{name?:string}}>};

const AVERAGE_CITY_SPEED_KMH=25;
function todayIso(){return new Date().toISOString().slice(0,10)}
function addMinutes(time:string,minutes:number){const [h,m]=time.split(":").map(Number);const total=h*60+m+Math.round(minutes);return `${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`}

function directionsUrl(stops:PreviewStop[]){
  const points=stops.map(stop=>stop.doctor.location?.coordinates).filter((c):c is number[]=>Boolean(c?.length)).map(c=>`${c[1]},${c[0]}`);
  if(points.length<2)return null;
  const waypoints=points.slice(1,-1).slice(0,9).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${points[0]}&destination=${points[points.length-1]}${waypoints?`&waypoints=${encodeURIComponent(waypoints)}`:""}&travelmode=driving`;
}

function StepHeader({step,title,description,done}:{step:number;title:string;description?:string;done?:boolean}){
  return <div className="flex items-start gap-3">
    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done?"bg-emerald-600 text-white":"bg-[#173f3a] text-white"}`}>{done?<Check size={15}/>:step}</span>
    <div className="min-w-0"><h2 className="font-semibold leading-7">{title}</h2>{description&&<p className="mt-0.5 text-sm text-[#697572]">{description}</p>}</div>
  </div>;
}

export default function RoutePlanner(){
  const [name,setName]=useState(`Route – ${todayIso()}`);
  const [date,setDate]=useState(todayIso());
  const [reference,setReference]=useState<DoctorSuggestion|null>(null);
  const [selected,setSelected]=useState<DoctorSuggestion[]>([]);
  const [uploading,setUploading]=useState(false);
  const fileInputRef=useRef<HTMLInputElement>(null);

  const [employees,setEmployees]=useState<Employee[]>([]);
  const [preview,setPreview]=useState<{stops:PreviewStop[];totalDistanceKm:number}|null>(null);
  const [calculating,setCalculating]=useState(false);
  const [assignedTo,setAssignedTo]=useState("");
  const [startTime,setStartTime]=useState("10:00");
  const [visitMinutes,setVisitMinutes]=useState(45);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [savedPlans,setSavedPlans]=useState<SavedPlan[]>([]);

  useEffect(()=>{
    fetch("/api/employees?limit=100").then(r=>r.json()).then((json:{data?:{items:Employee[]}})=>setEmployees((json.data?.items??[]).filter(e=>e.role==="MR"||e.role==="SALES")));
    loadSavedPlans();
  },[]);

  async function loadSavedPlans(){const response=await fetch("/api/route-plans?limit=8");const json=await response.json() as {data?:{items:SavedPlan[]}};setSavedPlans(json.data?.items??[])}

  const excludeIds=new Set([reference?._id,...selected.map(d=>d._id)].filter((id):id is string=>Boolean(id)));

  function addDoctor(doctor:DoctorSuggestion){setPreview(null);setSelected(current=>[...current,doctor])}
  function removeDoctor(id:string){setPreview(null);setSelected(current=>current.filter(d=>d._id!==id))}
  function changeReference(){setPreview(null);setReference(null)}

  async function uploadExcel(event:React.ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    setUploading(true);setMessage("");setPreview(null);
    try{
      const XLSX=await import("xlsx");
      const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});
      const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets[workbook.SheetNames[0]],{defval:""});
      const parsed=rows.map((row,index)=>excelRowToExternalDoctor(row,`file-${Date.now()}-${index}`)).filter(item=>item.displayName?.text);
      if(!parsed.length){setMessage("No valid rows found — the sheet needs a Doctor or Clinic column.");return}
      const response=await fetch("/api/doctors/bulk",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({doctors:parsed.map(externalDoctorToPayload)})});
      const json=await response.json() as {error?:string;data?:{ids:string[]}};
      if(!response.ok)throw new Error(json.error??"Could not save the doctors from that file");
      const ids=json.data?.ids??[];
      const skipped:string[]=[];
      const fromFile=parsed.map((item,index):DoctorSuggestion|null=>{
        const id=ids[index];
        if(!id)return null;
        if(!item.location){skipped.push(item.displayName?.text??"Unknown");return null}
        return {_id:id,name:item.displayName?.text??"Unknown doctor",fullAddress:item.formattedAddress,phones:item.nationalPhoneNumber?[item.nationalPhoneNumber]:[],location:{coordinates:[item.location.longitude,item.location.latitude]}};
      }).filter((doctor):doctor is DoctorSuggestion=>doctor!==null&&!excludeIds.has(doctor._id));
      setSelected(current=>{const seen=new Set(current.map(d=>d._id));return [...current,...fromFile.filter(d=>!seen.has(d._id))]});
      setMessage(`${fromFile.length} doctor(s) added from the sheet.${skipped.length?` ${skipped.length} skipped — no latitude/longitude: ${skipped.slice(0,4).join(", ")}${skipped.length>4?"…":""}`:""}`);
    }catch(error){setMessage(error instanceof Error?error.message:"Could not read that file")}finally{setUploading(false)}
  }

  async function calculateRoute(){
    if(!reference||!selected.length)return;
    setCalculating(true);setMessage("");setPreview(null);
    try{
      const response=await fetch("/api/route-plans/preview",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({doctorIds:[reference._id,...selected.map(d=>d._id)],referenceDoctorId:reference._id})});
      const json=await response.json() as {error?:string;data?:{stops:PreviewStop[];totalDistanceKm:number}};
      if(!response.ok)throw new Error(json.error??"Could not calculate the route");
      setPreview(json.data??null);
    }catch(error){setMessage(error instanceof Error?error.message:"Could not calculate the route")}finally{setCalculating(false)}
  }

  async function savePlan(){
    if(!preview||!reference)return;
    setSaving(true);setMessage("");
    try{
      const response=await fetch("/api/route-plans",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,date,referenceDoctorId:reference._id,doctorIds:[reference._id,...selected.map(d=>d._id)],assignedTo:assignedTo||undefined,startTime,visitMinutes})});
      const json=await response.json() as {error?:string};
      if(!response.ok)throw new Error(json.error??"Could not save the plan");
      setMessage(assignedTo?"Plan saved and assigned — the visits are now on that employee's schedule for the chosen date.":"Plan saved as a draft.");
      setReference(null);setSelected([]);setPreview(null);setAssignedTo("");
      loadSavedPlans();
    }catch(error){setMessage(error instanceof Error?error.message:"Could not save the plan")}finally{setSaving(false)}
  }

  const travelMinutes=preview?(preview.totalDistanceKm/AVERAGE_CITY_SPEED_KMH)*60:0;
  const finishTime=preview?addMinutes(startTime,travelMinutes+preview.stops.length*visitMinutes):"";
  const mapsLink=preview?directionsUrl(preview.stops):null;

  // Arrival time per stop: previous arrival + time spent at that doctor + travel to this one.
  const stopTimes:string[]=[];
  if(preview){
    let offset=0;
    preview.stops.forEach((stop,index)=>{
      if(index>0)offset+=visitMinutes+(stop.distanceFromPreviousKm/AVERAGE_CITY_SPEED_KMH)*60;
      stopTimes.push(addMinutes(startTime,offset));
    });
  }

  return <div className="space-y-5 pb-24">
    <PageHeader title="Route planner" subtitle="Build the shortest doctor visit route for a day and assign it to your field team"/>

    <section className="surface p-5">
      <StepHeader step={1} title="Plan details" done={Boolean(date&&name.trim())}/>
      <div className="mt-4 grid gap-4 pl-10 sm:grid-cols-2">
        <label className="text-sm font-medium">Plan name<input value={name} onChange={e=>setName(e.target.value)} className="tap mt-2 w-full rounded-xl border border-[#ccd5d2] px-3"/></label>
        <label className="text-sm font-medium">Visit date<div className="relative"><CalendarDays size={17} className="pointer-events-none absolute left-3 top-3.5 text-[#71807c]"/><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="tap mt-2 w-full rounded-xl border border-[#ccd5d2] pl-10 pr-3"/></div></label>
      </div>
    </section>

    <section className="surface p-5">
      <StepHeader step={2} title="Starting doctor" description="The route begins here, then always moves to the nearest doctor remaining." done={Boolean(reference)}/>
      <div className="mt-4 pl-10">
        {reference?<div className="flex items-center gap-3 rounded-xl border border-[#4d8078] bg-[#f7fbfa] p-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#173f3a] text-white"><Navigation size={15}/></span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{reference.name}</p><p className="truncate text-xs text-[#697572]">{doctorPlace(reference)}</p></div>
          <button onClick={changeReference} className="tap inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#cad5d2] bg-white px-3 text-xs font-semibold"><Pencil size={13}/>Change</button>
        </div>:<DoctorSearchInput placeholder="Search the doctor you will start the day from" excludeIds={excludeIds} onSelect={doctor=>{setPreview(null);setReference(doctor)}}/>}
      </div>
    </section>

    <section className={`surface p-5 ${reference?"":"pointer-events-none opacity-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <StepHeader step={3} title="Doctors to visit" description="Type to search, or upload the Excel sheet exported from doctor search." done={selected.length>0}/>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={uploadExcel} className="hidden"/>
        <button onClick={()=>fileInputRef.current?.click()} disabled={uploading||!reference} className="tap inline-flex shrink-0 items-center gap-2 rounded-xl border border-[#cad5d2] bg-white px-4 text-sm font-semibold disabled:opacity-50">{uploading?<Loader2 size={16} className="animate-spin"/>:<Upload size={16}/>}{uploading?"Uploading…":"Upload Excel"}</button>
      </div>

      <div className="mt-4 pl-10">
        <DoctorSearchInput placeholder="Add a doctor to this route" excludeIds={excludeIds} onSelect={addDoctor}/>

        {selected.length>0?<>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#697572]"><Users size={14}/>{selected.length} doctor{selected.length===1?"":"s"} added</div>
          <ul className="mt-2 divide-y divide-[#edf0ef] rounded-xl border border-[#e5e9e7]">{selected.map(doctor=><li key={doctor._id} className="flex items-center gap-3 px-3 py-2.5">
            <MapPin size={15} className="shrink-0 text-[#52716b]"/>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{doctor.name}</p><p className="truncate text-xs text-[#697572]">{doctorPlace(doctor)}</p></div>
            <button onClick={()=>removeDoctor(doctor._id)} aria-label={`Remove ${doctor.name}`} className="tap grid size-9 shrink-0 place-items-center rounded-xl text-red-600 hover:bg-red-50"><Trash2 size={15}/></button>
          </li>)}</ul>
        </>:<p className="mt-3 rounded-xl border border-dashed border-[#d6dedb] px-4 py-6 text-center text-sm text-[#8a9591]">No doctors added yet</p>}

        <button onClick={calculateRoute} disabled={!selected.length||calculating} className="tap mt-4 inline-flex items-center gap-2 rounded-xl bg-[#173f3a] px-5 text-sm font-semibold text-white disabled:opacity-50">{calculating?<Loader2 size={17} className="animate-spin"/>:<Route size={17}/>}{calculating?"Calculating…":preview?"Recalculate route":"Calculate shortest route"}</button>
      </div>
    </section>

    {preview&&<section className="surface p-5">
      <StepHeader step={4} title="Route and assignment"/>

      <div className="mt-4 pl-10">
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-[#e5e9e7] bg-[#fafbfa] p-4 sm:grid-cols-4">
          <div><p className="text-xs text-[#697572]">Stops</p><p className="mt-0.5 text-xl font-semibold">{preview.stops.length}</p></div>
          <div><p className="text-xs text-[#697572]">Total distance</p><p className="mt-0.5 text-xl font-semibold">{preview.totalDistanceKm} km</p></div>
          <div><p className="text-xs text-[#697572]">Est. travel</p><p className="mt-0.5 text-xl font-semibold">{Math.round(travelMinutes)} min</p></div>
          <div><p className="text-xs text-[#697572]">Est. finish</p><p className="mt-0.5 text-xl font-semibold">{finishTime}</p></div>
        </div>
        <p className="mt-2 text-xs text-[#8a9591]">Travel time is a straight-line estimate at {AVERAGE_CITY_SPEED_KMH} km/h, not live traffic.</p>

        <ol className="mt-4 space-y-2">{preview.stops.map(stop=><li key={stop.doctor._id} className="flex items-center gap-3 rounded-xl border border-[#e5e9e7] p-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#173f3a] text-xs font-bold text-white">{stop.sequence}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{stop.doctor.name}{stop.sequence===1&&<span className="ml-2 text-xs font-medium text-[#285f57]">Start</span>}</p><p className="truncate text-xs text-[#697572]">{doctorPlace(stop.doctor)}</p></div>
          <div className="shrink-0 text-right"><p className="text-xs font-semibold text-[#40504c]">{stopTimes[stop.sequence-1]}</p><p className="text-xs text-[#8a9591]">{stop.sequence===1?"—":`+${stop.distanceFromPreviousKm} km`}</p></div>
        </li>)}</ol>

        {mapsLink&&<a href={mapsLink} target="_blank" rel="noreferrer" className="tap mt-3 inline-flex items-center gap-2 rounded-xl border border-[#cad5d2] bg-white px-4 text-sm font-semibold"><ExternalLink size={15}/>Open route in Google Maps</a>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Assign to<div className="relative"><Target size={17} className="pointer-events-none absolute left-3 top-3.5 text-[#71807c]"/><select value={assignedTo} onChange={e=>setAssignedTo(e.target.value)} className="tap mt-2 w-full rounded-xl border border-[#ccd5d2] bg-white pl-10 pr-3"><option value="">Save as draft (assign later)</option>{employees.map(employee=><option key={employee._id} value={employee._id}>{employee.name} ({employee.employeeId})</option>)}</select></div></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-medium">Start time<div className="relative"><Clock3 size={17} className="pointer-events-none absolute left-3 top-3.5 text-[#71807c]"/><input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} className="tap mt-2 w-full rounded-xl border border-[#ccd5d2] pl-10 pr-3"/></div></label>
            <label className="text-sm font-medium">Min. per visit<input type="number" min={10} max={240} value={visitMinutes} onChange={e=>setVisitMinutes(Number(e.target.value)||45)} className="tap mt-2 w-full rounded-xl border border-[#ccd5d2] px-3"/></label>
          </div>
        </div>

        <button onClick={savePlan} disabled={saving} className="tap mt-5 inline-flex items-center gap-2 rounded-xl bg-[#173f3a] px-5 text-sm font-semibold text-white disabled:opacity-50"><Save size={17}/>{saving?"Saving…":assignedTo?"Save and assign":"Save as draft"}</button>
      </div>
    </section>}

    {message&&<p role="status" className="rounded-xl border border-[#dce4e1] bg-white px-4 py-3 text-sm font-medium text-[#40504c]">{message}</p>}

    <section>
      <h2 className="mb-3 font-semibold">Saved plans</h2>
      {savedPlans.length?<div className="surface divide-y divide-[#edf0ef]">{savedPlans.map(plan=><Link key={plan._id} href={`/admin/route-planner/${plan._id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-[#fafbfa]">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{plan.name}</p><p className="mt-0.5 truncate text-xs text-[#697572]">{new Date(plan.date).toLocaleDateString("en-IN")} · {plan.stops.length} stops · {plan.totalDistanceKm} km{plan.assignedTo?.name&&` · ${plan.assignedTo.name}`}</p></div>
        <span className="shrink-0 rounded-full bg-[#eaf1ef] px-2.5 py-1 text-xs font-semibold text-[#173f3a]">{plan.status}</span>
      </Link>)}</div>:<div className="surface p-8 text-center text-sm text-[#697572]"><MapPin className="mx-auto mb-2 text-[#80908c]" size={24}/>No saved plans yet</div>}
    </section>
  </div>;
}
