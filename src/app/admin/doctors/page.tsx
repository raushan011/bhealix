"use client";

import { useEffect,useState } from "react";
import Link from "next/link";
import { CalendarClock,ExternalLink,Loader2,Mail,MapPin,Pencil,Phone,Plus,Search,Trash2,X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

const DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

type DoctorRow={
  _id:string;name:string;clinicName?:string;specialties?:string[];doctorTypes?:string[];
  city?:string;area?:string;fullAddress?:string;phones?:string[];email?:string;googleMapsUrl?:string;
  priority:string;stage:string;status:string;location?:{coordinates?:number[]};
};
type ScheduleEntry={_id:string;weekday:number;slots:Array<{start:string;end:string}>;appointmentRequired?:boolean;instructions?:string};

export default function DoctorDirectory(){
  const [query,setQuery]=useState("");
  const [doctors,setDoctors]=useState<DoctorRow[]>([]);
  const [page,setPage]=useState(1);
  const [pages,setPages]=useState(1);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState<{tone:"success"|"error";text:string}|null>(null);
  const [deletingId,setDeletingId]=useState<string>();
  const [scheduleDoctor,setScheduleDoctor]=useState<DoctorRow|null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load intentionally runs once on mount
  useEffect(()=>{load(1)},[]);

  async function load(nextPage:number){
    setLoading(true);
    try{
      const response=await fetch(`/api/doctors?q=${encodeURIComponent(query)}&page=${nextPage}&limit=24`);
      const json=await response.json() as {data?:{items:DoctorRow[];total:number;pages:number}};
      setDoctors(json.data?.items??[]);setPage(nextPage);setPages(json.data?.pages??1);setTotal(json.data?.total??0);
    }finally{setLoading(false)}
  }

  async function removeDoctor(doctor:DoctorRow){
    if(!window.confirm(`Remove ${doctor.name}? This archives the record rather than deleting it permanently.`))return;
    setDeletingId(doctor._id);
    try{
      const response=await fetch(`/api/doctors/${doctor._id}`,{method:"DELETE"});
      if(!response.ok)throw new Error("Could not remove this doctor");
      setDoctors(current=>current.filter(item=>item._id!==doctor._id));
      setNotice({tone:"success",text:`${doctor.name} archived successfully.`});
    }catch(error){setNotice({tone:"error",text:error instanceof Error?error.message:"Could not remove this doctor"})}
    finally{setDeletingId(undefined)}
  }

  return <div className="space-y-6 pb-24">
    <PageHeader title="Doctor directory" subtitle={`${total} saved doctor${total===1?"":"s"}`} actions={<Link href="/admin/doctors/new" className="tap inline-flex items-center gap-2 rounded-xl bg-[#173f3a] px-4 text-sm font-semibold text-white"><Plus size={17}/>Add doctor</Link>}/>

    <section className="surface p-4 sm:p-5">
      <div className="flex gap-2">
        <div className="relative flex-1"><Search size={17} className="absolute left-3 top-3.5 text-[#71807c]"/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")load(1)}} placeholder="Search by name, clinic, city, area, phone or email" className="tap w-full rounded-xl border border-[#cdd6d3] pl-10 pr-3"/></div>
        <button onClick={()=>load(1)} className="tap rounded-xl bg-[#173f3a] px-5 text-sm font-semibold text-white">Search</button>
      </div>
    </section>

    {notice&&<div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${notice.tone==="success"?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-red-200 bg-red-50 text-red-800"}`}>{notice.text}</div>}

    {loading&&<div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-[#80908c]" size={28}/></div>}

    {!loading&&!doctors.length&&<EmptyState title="No doctors found" action="Add first doctor" href="/admin/doctors/new"/>}

    {!loading&&doctors.length>0&&<>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{doctors.map(doctor=>{
        const coordinates=doctor.location?.coordinates;
        const locationLine=[doctor.area,doctor.city].filter(Boolean).join(", ")||doctor.fullAddress||"Location not set";
        return <article key={doctor._id} className="surface flex flex-col p-4">
          <div className="flex items-start gap-2 border-b border-[#edf0ef] pb-3"><MapPin size={17} className="mt-0.5 shrink-0 text-[#52716b]"/><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#2b3936]">{locationLine}</p>{doctor.fullAddress&&doctor.fullAddress!==locationLine&&<p className="truncate text-xs text-[#697572]">{doctor.fullAddress}</p>}{!coordinates?.length&&<p className="text-xs text-amber-700">No GPS coordinates saved</p>}</div>{doctor.googleMapsUrl&&<a href={doctor.googleMapsUrl} target="_blank" rel="noreferrer" aria-label="Open in Google Maps" className="tap ml-auto grid size-9 shrink-0 place-items-center rounded-xl text-[#52716b] hover:bg-[#f4f6f5]"><ExternalLink size={16}/></a>}</div>

          <div className="flex-1 pt-3"><div className="flex items-start justify-between gap-2"><h2 className="min-w-0 truncate font-semibold">{doctor.name}</h2><StatusBadge value={doctor.priority}/></div><p className="mt-0.5 truncate text-xs text-[#697572]">{doctor.clinicName??(doctor.doctorTypes??doctor.specialties)?.join(", ")??"—"}</p>
            <div className="mt-3 grid gap-1.5 text-xs text-[#56635f]">
              <p className="flex items-center gap-2"><Phone size={13}/>{doctor.phones?.[0]??"Not available"}</p>
              <p className="flex items-center gap-2"><Mail size={13}/>{doctor.email??"Not available"}</p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 border-t border-[#edf0ef] pt-3">
            <Link href={`/admin/doctors/${doctor._id}/edit`} className="tap flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#cad5d2] bg-white text-xs font-semibold"><Pencil size={14}/>Edit</Link>
            <button onClick={()=>setScheduleDoctor(doctor)} className="tap flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#cad5d2] bg-white text-xs font-semibold"><CalendarClock size={14}/>MR call time</button>
            <button onClick={()=>removeDoctor(doctor)} disabled={deletingId===doctor._id} aria-label={`Remove ${doctor.name}`} className="tap grid size-9 shrink-0 place-items-center rounded-xl text-red-600 hover:bg-red-50 disabled:opacity-50">{deletingId===doctor._id?<Loader2 size={16} className="animate-spin"/>:<Trash2 size={16}/>}</button>
          </div>
        </article>;
      })}</div>

      <nav className="flex flex-col items-center justify-between gap-3 rounded-xl border border-[#dce4e1] bg-white px-4 py-3 sm:flex-row"><p className="text-sm text-[#697572]">Page {page} of {pages}</p><div className="flex items-center gap-2"><button onClick={()=>load(page-1)} disabled={page<=1} className="tap rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Previous</button><button onClick={()=>load(page+1)} disabled={page>=pages} className="tap rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Next</button></div></nav>
    </>}

    {scheduleDoctor&&<MrCallTimeModal doctor={scheduleDoctor} onClose={()=>setScheduleDoctor(null)}/>}
  </div>;
}

function MrCallTimeModal({doctor,onClose}:{doctor:DoctorRow;onClose:()=>void}){
  const [existing,setExisting]=useState<ScheduleEntry[]>([]);
  const [loading,setLoading]=useState(true);
  const [weekdays,setWeekdays]=useState<number[]>([1]);
  const [start,setStart]=useState("10:00");
  const [end,setEnd]=useState("12:00");
  const [appointmentRequired,setAppointmentRequired]=useState(false);
  const [instructions,setInstructions]=useState("");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    fetch(`/api/mr-schedules?doctor=${doctor._id}`).then(r=>r.json()).then((json:{data?:{items:ScheduleEntry[]}})=>setExisting(json.data?.items??[])).finally(()=>setLoading(false));
  },[doctor._id]);

  function toggleDay(day:number){setWeekdays(current=>current.includes(day)?current.filter(d=>d!==day):[...current,day].sort())}
  function toggleAllDays(){setWeekdays(current=>current.length===DAYS.length?[]:DAYS.map((_,index)=>index))}

  async function save(){
    if(!weekdays.length){setError("Choose at least one day");return}
    setSaving(true);setError("");
    try{
      const saved=await Promise.all(weekdays.map(async weekday=>{
        const response=await fetch("/api/mr-schedules",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({doctor:doctor._id,weekday,start,end,appointmentRequired,instructions})});
        const json=await response.json() as {error?:string;data?:ScheduleEntry};
        if(!response.ok)throw new Error(json.error??"Could not save call time");
        return json.data as ScheduleEntry;
      }));
      setExisting(current=>{const savedDays=new Set(saved.map(entry=>entry.weekday));const next=current.filter(entry=>!savedDays.has(entry.weekday));return [...next,...saved].sort((a,b)=>a.weekday-b.weekday)});
      setInstructions("");
    }catch(error){setError(error instanceof Error?error.message:"Could not save call time")}finally{setSaving(false)}
  }

  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4"><div className="surface w-full max-w-lg p-6">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">MR call time &amp; remarks</h2><p className="mt-0.5 text-sm text-[#697572]">{doctor.name}</p></div><button onClick={onClose} aria-label="Close" className="tap grid size-9 shrink-0 place-items-center rounded-xl hover:bg-[#f4f6f5]"><X size={18}/></button></div>

    {!loading&&existing.length>0&&<div className="mt-4 space-y-2 rounded-xl border border-[#e5e9e7] p-3">{existing.map(entry=><div key={entry._id} className="text-sm"><span className="font-semibold">{DAYS[entry.weekday]}</span> · {entry.slots.map(slot=>`${slot.start}–${slot.end}`).join(", ")}{entry.appointmentRequired&&<span className="ml-2 text-xs text-amber-700">Appointment required</span>}{entry.instructions&&<p className="mt-0.5 text-xs text-[#697572]">{entry.instructions}</p>}</div>)}</div>}

    <div className="mt-5">
      <div className="flex items-center justify-between"><span className="text-sm font-medium">Days</span><button type="button" onClick={toggleAllDays} className="tap text-xs font-semibold text-[#285f57]">{weekdays.length===DAYS.length?"Clear all":"All days"}</button></div>
      <div className="mt-2 flex flex-wrap gap-2">{DAYS.map((day,index)=>{const checked=weekdays.includes(index);return <button type="button" key={day} onClick={()=>toggleDay(index)} className={`tap rounded-xl border px-3 text-xs font-semibold ${checked?"border-[#173f3a] bg-[#173f3a] text-white":"border-[#ccd5d2] bg-white text-[#40504c]"}`}>{day.slice(0,3)}</button>})}</div>
    </div>

    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="flex items-end gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" checked={appointmentRequired} onChange={e=>setAppointmentRequired(e.target.checked)} className="size-4 accent-[#173f3a]"/>Appointment required</label>
      <label className="text-sm font-medium">Start time<input type="time" value={start} onChange={e=>setStart(e.target.value)} className="tap mt-2 w-full rounded-xl border border-[#ccd5d2] px-3"/></label>
      <label className="text-sm font-medium">End time<input type="time" value={end} onChange={e=>setEnd(e.target.value)} className="tap mt-2 w-full rounded-xl border border-[#ccd5d2] px-3"/></label>
      <label className="text-sm font-medium sm:col-span-2">Remarks<textarea value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="e.g. token system, lunch break 1–2pm" className="mt-2 min-h-20 w-full rounded-xl border border-[#ccd5d2] p-3"/></label>
    </div>
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <button onClick={save} disabled={saving} className="tap mt-5 w-full rounded-xl bg-[#173f3a] text-sm font-semibold text-white disabled:opacity-60">{saving?"Saving…":`Save call time${weekdays.length>1?` for ${weekdays.length} days`:""}`}</button>
  </div></div>;
}
