"use client";

import { useMemo,useRef,useState } from "react";
import { CheckCircle2,CheckSquare,Download,ExternalLink,MapPin,RefreshCw,Save,Search,Star,Trash2,Upload,X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { doctorSearchSchema,excelRowToExternalDoctor,externalDoctorToPayload,SKIN_DOCTOR_TYPES,type ExternalDoctor } from "@/lib/doctors/search";

const RADII=[1,2,5,10,20,25,50,75,100];

export default function DoctorSearch(){
  const [doctorType,setDoctorType]=useState<(typeof SKIN_DOCTOR_TYPES)[number]>("Dermatologist");
  const [location,setLocation]=useState("Noida");
  const [radiusKm,setRadiusKm]=useState(10);
  const [resultLimit,setResultLimit]=useState<100|200|500>(100);
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(20);
  const [items,setItems]=useState<ExternalDoctor[]>([]);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [saveResult,setSaveResult]=useState<{created:number;updated:number;names:string[]}|null>(null);
  const fileInputRef=useRef<HTMLInputElement>(null);
  const allSelected=items.length>0&&items.every(item=>selected.has(item.id));
  const selectedItems=useMemo(()=>items.filter(item=>selected.has(item.id)),[items,selected]);
  const totalPages=Math.max(1,Math.ceil(items.length/pageSize));
  const visibleItems=useMemo(()=>items.slice((page-1)*pageSize,page*pageSize),[items,page,pageSize]);

  async function searchDoctors(){
    const input={doctorType,location,radiusKm};
    const parsed=doctorSearchSchema.safeParse(input);
    if(!parsed.success){setMessage(parsed.error.issues[0]?.message??"Check the search details");return}
    setBusy(true);setMessage("");setItems([]);setSelected(new Set());setPage(1);
    try{
      const response=await fetch("/api/google/doctors",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({location:parsed.data.location,radiusKm:parsed.data.radiusKm,resultLimit,terms:[parsed.data.doctorType]})});
      const json=await response.json() as {error?:string;data?:{items:ExternalDoctor[];searchedZones:number;apiRequests:number;cached?:boolean}};
      if(!response.ok)throw new Error(json.error??"Doctor search failed");
      const results=json.data?.items??[];setItems(results);setMessage(results.length?`${results.length} results found across ${json.data?.searchedZones??1} search zone(s)${json.data?.cached?" · cached result":""}.`:"No matching doctors or clinics found.");
    }catch(error){setMessage(error instanceof Error?error.message:"Doctor search failed")}finally{setBusy(false)}
  }

  function toggle(id:string){setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})}
  function toggleAll(){setSelected(allSelected?new Set():new Set(items.map(item=>item.id)))}
  function removeSelected(){if(!selected.size)return;setItems(current=>current.filter(item=>!selected.has(item.id)));setSelected(new Set());setPage(1);setMessage(`${selected.size} result(s) removed from this list.`)}
  function newSearch(){setItems([]);setSelected(new Set());setMessage("");setDoctorType("Dermatologist");setLocation("");setRadiusKm(10);setResultLimit(100);setPage(1)}

  async function saveSelected(){
    if(!selectedItems.length)return;
    setSaving(true);setMessage("");
    const names=selectedItems.map(item=>item.displayName?.text??"Unknown doctor");
    try{const response=await fetch("/api/doctors/bulk",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({doctors:selectedItems.map(externalDoctorToPayload)})});const json=await response.json() as {error?:string;data?:{created:number;updated:number}};if(!response.ok)throw new Error(json.error??"Could not save doctors");setSaveResult({created:json.data?.created??0,updated:json.data?.updated??0,names});setSelected(new Set())}catch(error){setMessage(error instanceof Error?error.message:"Could not save doctors")}finally{setSaving(false)}
  }

  async function downloadExcel(){
    if(!items.length)return;
    const XLSX=await import("xlsx");
    const rows=items.map(item=>({"Doctor or Clinic":item.displayName?.text??"Not available",Type:item.category,Rating:item.rating??"Not available",Reviews:item.userRatingCount??0,Address:item.formattedAddress??"Not available",Distance:`${item.distanceKm} km`,Mobile:item.nationalPhoneNumber??"Not available",Email:item.email??"Not available","Google Maps":item.googleMapsUri??"Not available","Place ID":item.fromFile?"":item.id,Latitude:item.location?.latitude??"",Longitude:item.location?.longitude??""}));
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),"Doctor search");XLSX.writeFile(workbook,`bhealix-${doctorType.toLowerCase().replaceAll(" ","-")}-${location.toLowerCase().replaceAll(" ","-")}.xlsx`);
  }

  async function uploadExcel(event:React.ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    setBusy(true);setMessage("");
    try{
      const XLSX=await import("xlsx");
      const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});
      const sheet=workbook.Sheets[workbook.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:""});
      const parsed=rows.map((row,index)=>excelRowToExternalDoctor(row,`file-${Date.now()}-${index}`)).filter(item=>item.displayName?.text);
      if(!parsed.length){setMessage("No valid rows found in that file — make sure it has a Doctor or Clinic column.");return}
      setItems(current=>[...parsed,...current]);
      setSelected(current=>{const next=new Set(current);parsed.forEach(item=>next.add(item.id));return next});
      setPage(1);
      setMessage(`${parsed.length} row(s) loaded from the file and selected below. Review, then save.`);
    }catch{setMessage("Could not read that file. Use the same format as the downloaded Excel sheet.")}finally{setBusy(false)}
  }

  return <div className="space-y-6 pb-24">
    <PageHeader title="Search doctors" subtitle="Google Places doctor and clinic discovery" actions={<>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={uploadExcel} className="hidden"/>
      <button onClick={()=>fileInputRef.current?.click()} disabled={busy} className="tap inline-flex items-center gap-2 rounded-xl border border-[#cad5d2] bg-white px-4 text-sm font-semibold disabled:opacity-50"><Upload size={17}/>Upload Excel</button>
      <button onClick={newSearch} className="tap inline-flex items-center gap-2 rounded-xl border border-[#cad5d2] bg-white px-4 text-sm font-semibold"><RefreshCw size={17}/>New search</button>
    </>}/>

    <section className="surface p-4 sm:p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_150px_150px_auto]">
        <label className="text-sm font-medium"><span className="mb-2 block text-xs text-[#697572]">1. Doctor type</span><select value={doctorType} onChange={event=>setDoctorType(event.target.value as typeof doctorType)} className="tap w-full rounded-xl border border-[#cdd6d3] bg-white px-3">{SKIN_DOCTOR_TYPES.map(type=><option key={type}>{type}</option>)}</select></label>
        <label className="text-sm font-medium"><span className="mb-2 block text-xs text-[#697572]">2. Location</span><div className="relative"><MapPin size={17} className="absolute left-3 top-3.5 text-[#71807c]"/><input value={location} onChange={event=>setLocation(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void searchDoctors()}} className="tap w-full rounded-xl border border-[#cdd6d3] pl-10 pr-3" placeholder="Noida, PIN code or landmark"/></div></label>
        <label className="text-sm font-medium"><span className="mb-2 block text-xs text-[#697572]">3. Radius</span><select value={radiusKm} onChange={event=>setRadiusKm(Number(event.target.value))} className="tap w-full rounded-xl border border-[#cdd6d3] bg-white px-3">{RADII.map(radius=><option key={radius} value={radius}>{radius} km</option>)}</select></label>
        <label className="text-sm font-medium"><span className="mb-2 block text-xs text-[#697572]">4. Maximum results</span><select value={resultLimit} onChange={event=>setResultLimit(Number(event.target.value) as 100|200|500)} className="tap w-full rounded-xl border border-[#cdd6d3] bg-white px-3"><option value={100}>100</option><option value={200}>200</option><option value={500}>500</option></select></label>
        <button onClick={searchDoctors} disabled={busy||!location.trim()} className="tap self-end rounded-xl bg-[#173f3a] px-6 text-sm font-semibold text-white disabled:opacity-50"><Search className="mr-2 inline" size={17}/>{busy?"Searching…":"Search"}</button>
      </div>
    </section>

    {message&&<p role="status" className="rounded-xl border border-[#dce4e1] bg-white px-4 py-3 text-sm font-medium text-[#40504c]">{message}</p>}

    {items.length>0&&<>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="tap flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-4 accent-[#173f3a]"/><CheckSquare size={17}/>{allSelected?"Clear all":"Select all"}</label>
        <div className="flex flex-wrap gap-2"><label className="flex items-center gap-2 text-sm text-[#697572]">Per page<select value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1)}} className="tap rounded-xl border bg-white px-2"><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><button onClick={removeSelected} disabled={!selected.size} className="tap inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 disabled:opacity-40"><Trash2 size={16}/>Remove selected</button><button onClick={downloadExcel} className="tap inline-flex items-center gap-2 rounded-xl border border-[#cad5d2] bg-white px-4 text-sm font-semibold"><Download size={16}/>Download Excel</button><button onClick={saveSelected} disabled={!selected.size||saving} className="tap inline-flex items-center gap-2 rounded-xl bg-[#173f3a] px-4 text-sm font-semibold text-white disabled:opacity-40"><Save size={16}/>{saving?"Saving…":`Save selected (${selected.size})`}</button></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">{visibleItems.map(item=>{
        const checked=selected.has(item.id);return <article key={item.id} className={`surface relative p-4 transition-colors ${checked?"border-[#4d8078] bg-[#f7fbfa]":""}`}>
          <label className="absolute right-4 top-4 grid size-11 cursor-pointer place-items-center rounded-xl hover:bg-[#edf3f1]"><input type="checkbox" checked={checked} onChange={()=>toggle(item.id)} aria-label={`Select ${item.displayName?.text??"doctor"}`} className="size-5 accent-[#173f3a]"/></label>
          <div className="pr-12"><h2 className="truncate font-semibold">{item.displayName?.text??"Not available"}</h2><p className="mt-1 text-xs text-[#697572]">{item.category} · {item.distanceKm} km</p></div>
          <div className="mt-4 grid gap-3 text-sm">
            <p className="flex items-start gap-2"><Star size={16} className="mt-0.5 shrink-0 text-[#b98639]" fill="#d3a768"/><span>{item.rating??"Not available"}{item.userRatingCount!==undefined&&` (${item.userRatingCount} reviews)`}</span></p>
            <p className="flex items-start gap-2 text-[#56635f]"><MapPin size={16} className="mt-0.5 shrink-0"/><span>{item.formattedAddress??"Not available"}</span></p>
            <div className="grid grid-cols-[74px_1fr] gap-y-2"><span className="text-[#7a8682]">Mobile</span><span>{item.nationalPhoneNumber??"Not available"}</span><span className="text-[#7a8682]">Email</span><span>{item.email??"Not available"}</span></div>
          </div>
          <div className="mt-4 border-t border-[#edf0ef] pt-3">{item.googleMapsUri?<a href={item.googleMapsUri} target="_blank" rel="noreferrer" className="tap inline-flex items-center gap-2 text-sm font-semibold text-[#285f57]">Open location <ExternalLink size={15}/></a>:<span className="text-sm text-[#7a8682]">Location link not available</span>}</div>
        </article>
      })}</div>
      <nav aria-label="Search result pages" className="flex flex-col items-center justify-between gap-3 rounded-xl border border-[#dce4e1] bg-white px-4 py-3 sm:flex-row"><p className="text-sm text-[#697572]">Showing {(page-1)*pageSize+1}–{Math.min(page*pageSize,items.length)} of {items.length}</p><div className="flex items-center gap-2"><button onClick={()=>setPage(current=>Math.max(1,current-1))} disabled={page===1} className="tap rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Previous</button><span className="px-2 text-sm font-semibold">{page} / {totalPages}</span><button onClick={()=>setPage(current=>Math.min(totalPages,current+1))} disabled={page===totalPages} className="tap rounded-xl border px-4 text-sm font-semibold disabled:opacity-40">Next</button></div></nav>
    </>}

    {!items.length&&!busy&&!message&&<div className="py-16 text-center"><Search className="mx-auto text-[#80908c]" size={32}/><h2 className="mt-3 font-semibold">Choose a doctor type and location</h2><p className="mt-1 text-sm text-[#697572]">Search results will appear here.</p></div>}

    {saveResult&&<div role="dialog" aria-modal="true" className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4"><div className="surface w-full max-w-md p-6"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={22}/></span><div><h2 className="font-semibold">Doctors saved</h2><p className="mt-0.5 text-sm text-[#697572]">{saveResult.created} new · {saveResult.updated} updated</p></div></div><button onClick={()=>setSaveResult(null)} aria-label="Close" className="tap grid size-9 shrink-0 place-items-center rounded-xl hover:bg-[#f4f6f5]"><X size={18}/></button></div><ul className="mt-5 max-h-64 divide-y divide-[#edf0ef] overflow-y-auto rounded-xl border border-[#e5e9e7]">{saveResult.names.map((name,index)=><li key={`${name}-${index}`} className="px-4 py-2.5 text-sm font-medium">{name}</li>)}</ul><button onClick={()=>setSaveResult(null)} className="tap mt-5 w-full rounded-xl bg-[#173f3a] text-sm font-semibold text-white">Done</button></div></div>}
  </div>
}
