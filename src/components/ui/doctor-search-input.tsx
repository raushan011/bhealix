"use client";

import { useEffect,useId,useRef,useState } from "react";
import { Loader2,MapPin,Search } from "lucide-react";

export type DoctorSuggestion={
  _id:string;name:string;clinicName?:string;area?:string;city?:string;fullAddress?:string;
  phones?:string[];location?:{coordinates?:number[]};
};

export const hasCoordinates=(doctor:DoctorSuggestion)=>Boolean(doctor.location?.coordinates?.length);
export const doctorPlace=(doctor:DoctorSuggestion)=>[doctor.clinicName,doctor.area,doctor.city].filter(Boolean).join(" · ")||doctor.fullAddress||"Location not set";

export function DoctorSearchInput({placeholder="Start typing a doctor, clinic, area or city",excludeIds,onSelect,autoFocus}:{
  placeholder?:string;
  excludeIds?:Set<string>;
  onSelect:(doctor:DoctorSuggestion)=>void;
  autoFocus?:boolean;
}){
  const [query,setQuery]=useState("");
  const [items,setItems]=useState<DoctorSuggestion[]>([]);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [active,setActive]=useState(0);
  const boxRef=useRef<HTMLDivElement>(null);
  const listId=useId();

  useEffect(()=>{
    const term=query.trim();
    if(term.length<2){setItems([]);setLoading(false);setOpen(false);return}
    setLoading(true);
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try{
        const response=await fetch(`/api/doctors?q=${encodeURIComponent(term)}&limit=8`,{signal:controller.signal});
        const json=await response.json() as {data?:{items:DoctorSuggestion[]}};
        setItems(json.data?.items??[]);setActive(0);setOpen(true);setLoading(false);
      }catch(error){if((error as Error).name!=="AbortError")setLoading(false)}
    },250);
    return()=>{clearTimeout(timer);controller.abort()};
  },[query]);

  useEffect(()=>{
    function onPointerDown(event:MouseEvent){if(!boxRef.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener("mousedown",onPointerDown);
    return()=>document.removeEventListener("mousedown",onPointerDown);
  },[]);

  const visible=items.filter(item=>!excludeIds?.has(item._id));

  function choose(doctor:DoctorSuggestion){
    if(!hasCoordinates(doctor))return;
    onSelect(doctor);setQuery("");setItems([]);setOpen(false);
  }

  function onKeyDown(event:React.KeyboardEvent<HTMLInputElement>){
    if(!open||!visible.length)return;
    if(event.key==="ArrowDown"){event.preventDefault();setActive(current=>(current+1)%visible.length)}
    else if(event.key==="ArrowUp"){event.preventDefault();setActive(current=>(current-1+visible.length)%visible.length)}
    else if(event.key==="Enter"){event.preventDefault();choose(visible[active])}
    else if(event.key==="Escape")setOpen(false);
  }

  return <div ref={boxRef} className="relative">
    <Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-[#71807c]"/>
    <input
      value={query}
      onChange={event=>setQuery(event.target.value)}
      onFocus={()=>{if(visible.length)setOpen(true)}}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      className="tap w-full rounded-xl border border-[#cdd6d3] bg-white pl-10 pr-10"
    />
    {loading&&<Loader2 size={16} className="absolute right-3 top-3.5 animate-spin text-[#80908c]"/>}

    {open&&<ul id={listId} role="listbox" className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-[#dfe5e2] bg-white py-1 shadow-lg">
      {visible.length?visible.map((doctor,index)=>{
        const routable=hasCoordinates(doctor);
        return <li key={doctor._id} role="option" aria-selected={index===active} aria-disabled={!routable}>
          <button
            type="button"
            disabled={!routable}
            onMouseEnter={()=>setActive(index)}
            onClick={()=>choose(doctor)}
            className={`flex w-full items-start gap-3 px-3 py-2.5 text-left ${!routable?"cursor-not-allowed opacity-55":index===active?"bg-[#f2f7f6]":""}`}
          >
            <MapPin size={15} className="mt-0.5 shrink-0 text-[#52716b]"/>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{doctor.name}</span>
              <span className="block truncate text-xs text-[#697572]">{doctorPlace(doctor)}</span>
              {!routable&&<span className="block text-xs text-amber-700">No GPS coordinates — add them on the doctor&apos;s edit page to route this doctor</span>}
            </span>
          </button>
        </li>;
      }):<li className="px-4 py-3 text-sm text-[#697572]">{loading?"Searching…":"No matching doctors"}</li>}
    </ul>}
  </div>;
}
