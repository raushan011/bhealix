"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarCheck, Home, RotateCcw, Stethoscope, UserRound } from "lucide-react";
import { Brand } from "@/components/ui/brand";
const items=[["Home",Home,"/employee"],["Today",CalendarCheck,"/employee/today"],["Doctors",Stethoscope,"/employee/doctors"],["Follow-ups",RotateCcw,"/employee/follow-ups"],["Profile",UserRound,"/employee/profile"]] as const;
function isActive(pathname:string,href:string){return href==="/employee"?pathname==="/employee":pathname.startsWith(href)}
export function EmployeeShell({children}:{children:React.ReactNode}){const pathname=usePathname();return <div className="min-h-screen pb-[calc(76px+env(safe-area-inset-bottom))]"><header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-[#dfe5e2] bg-white/95 px-4"><Brand/><button aria-label="Notifications" className="tap grid place-items-center"><Bell size={20}/></button></header><main className="mx-auto max-w-2xl px-4 py-6">{children}</main><nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[#dfe5e2] bg-white pb-[env(safe-area-inset-bottom)]"><div className="mx-auto grid h-[68px] max-w-2xl grid-cols-5">{items.map(([label,Icon,href])=><Link href={href} key={label} className={`tap flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${isActive(pathname,href)?"text-[#173f3a]":"text-[#75817e]"}`}><Icon size={20}/>{label}</Link>)}</div></nav></div>}
