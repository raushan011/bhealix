import { Sparkles } from "lucide-react";
export function Brand({ compact=false }: { compact?: boolean }) { return <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#173f3a] text-white"><Sparkles size={18}/></span>{!compact&&<span className="text-[15px] font-bold tracking-[.16em] text-[#173f3a]">BHEALIX</span>}</div>; }
