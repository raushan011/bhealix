"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle,Trash2 } from "lucide-react";
import { EmptyState } from "./empty-state";

type Row={_id?:unknown;[key:string]:unknown};
const show=(value:unknown):string=>{if(value==null)return "—";if(typeof value==="boolean")return value?"Active":"Inactive";if(typeof value==="string"||typeof value==="number")return String(value);if(value instanceof Date)return value.toLocaleDateString("en-IN");if(Array.isArray(value))return value.map(show).join(", ");if(typeof value==="object"&&"name" in value)return show((value as {name:unknown}).name);return "—"};

export function DataList({rows,columns,detailBase,resource}:{rows:Row[];columns:Array<{key:string;label:string}>;detailBase?:string;resource?:string}){
  const router=useRouter();
  const [deleting,setDeleting]=useState<string>();
  const [notice,setNotice]=useState<{tone:"success"|"error";text:string}>();
  if(!rows.length)return <EmptyState title="No records yet" action="Add first record" href={detailBase?`${detailBase}/new`:undefined}/>;

  async function remove(id:string,label:string){
    if(!resource||!window.confirm(`Are you sure you want to remove ${label}?`))return;
    setDeleting(id);setNotice(undefined);
    try{const response=await fetch(`/api/${resource}/${id}`,{method:"DELETE"});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error??"Delete failed");setNotice({tone:"success",text:resource==="doctors"?"Doctor archived successfully.":resource==="employees"?"Employee deactivated successfully.":"Record deleted successfully."});router.refresh()}catch(error){setNotice({tone:"error",text:error instanceof Error?error.message:"Could not delete record"})}finally{setDeleting(undefined)}
  }

  const gridColumns=columns.length+(resource?1:0);
  return <div className="space-y-3">
    {notice&&<div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${notice.tone==="success"?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-red-200 bg-red-50 text-red-800"}`}>{notice.text}</div>}
    <div className="surface overflow-hidden">
      <div className="hidden border-b border-[#e5e9e7] bg-[#fafbfa] px-5 py-3 text-xs font-semibold text-[#697572] md:grid" style={{gridTemplateColumns:`repeat(${columns.length}, minmax(0, 1fr)) ${resource?"72px":""}`}}>{columns.map(column=><span key={column.key}>{column.label}</span>)}{resource&&<span className="text-right">Actions</span>}</div>
      <div className="divide-y divide-[#edf0ef]">{rows.map((row,index)=>{const id=String(row._id??index);const label=show(row.name??row.doctor??"this record");return <div key={id} className="grid items-center hover:bg-[#fafbfa]" style={{gridTemplateColumns:`minmax(0, 1fr) ${resource?"64px":""}`}}><Link href={detailBase?`${detailBase}/${id}`:"#"} aria-disabled={!detailBase} className={`grid gap-2 px-5 py-4 md:grid-cols-[repeat(var(--cols),minmax(0,1fr))] ${detailBase?"cursor-pointer":"pointer-events-none"}`} style={{"--cols":columns.length} as React.CSSProperties}>{columns.map((column,columnIndex)=><div key={column.key} className="min-w-0"><span className="mb-0.5 block text-[11px] font-medium text-[#7a8682] md:hidden">{column.label}</span><span className={`block truncate text-sm ${columnIndex===0?"font-semibold":"text-[#56635f]"}`}>{show(row[column.key])}</span></div>)}</Link>{resource&&<button type="button" onClick={()=>remove(id,label)} disabled={deleting===id} aria-label={`Remove ${label}`} className="tap mr-2 grid cursor-pointer place-items-center rounded-xl text-red-600 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50">{deleting===id?<LoaderCircle size={17} className="animate-spin"/>:<Trash2 size={17}/>}</button>}</div>})}</div>
    </div>
    <p className="sr-only">Table has {gridColumns} columns.</p>
  </div>
}
