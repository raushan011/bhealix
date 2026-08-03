"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, ClipboardCheck, FileBarChart, LayoutDashboard, Route, Search, Settings, Stethoscope, Users, UserRoundCheck, WalletCards } from "lucide-react";
import { Brand } from "@/components/ui/brand";
const nav=[["Dashboard",LayoutDashboard,"/admin"],["Doctor search",Search,"/admin/doctors/search"],["Doctor directory",Stethoscope,"/admin/doctors"],["Route planner",Route,"/admin/route-planner"],["Assignments",UserRoundCheck,"/admin/assignments"],["Employees",Users,"/admin/employees"],["Visits",ClipboardCheck,"/admin/visits"],["Follow-ups",CalendarDays,"/admin/follow-ups"],["Orders",WalletCards,"/admin/orders"],["Reports",FileBarChart,"/admin/reports"],["Settings",Settings,"/admin/settings"]] as const;

function isActive(pathname:string,href:string){return href==="/admin"?pathname==="/admin":pathname.startsWith(href)}
function initials(name:string){return name.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join("").toUpperCase()||"?"}

export function AdminShell({children,user}:{children:React.ReactNode;user:{name:string;role:string}}) {
  const pathname=usePathname();
  return <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]"><aside className="hidden border-r border-[#dfe5e2] bg-white px-4 py-6 lg:flex lg:flex-col"><div className="px-2"><Brand/></div><nav className="mt-10 space-y-1">{nav.map(([label,Icon,href])=><Link key={label} href={href} className={`tap flex items-center gap-3 rounded-xl px-3 text-sm font-medium ${isActive(pathname,href)?"bg-[#eaf1ef] text-[#173f3a]":"text-[#62706c] hover:bg-[#f4f6f5]"}`}><Icon size={18}/>{label}</Link>)}</nav><div className="mt-auto border-t border-[#e2e7e4] pt-4"><div className="flex items-center gap-3 px-2"><span className="grid size-9 place-items-center rounded-full bg-[#173f3a] text-xs font-bold text-white">{initials(user.name)}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{user.name}</p><p className="text-xs text-[#73807c]">{user.role[0]+user.role.slice(1).toLowerCase()}</p></div></div></div></aside><div><header className="flex h-16 items-center justify-between border-b border-[#dfe5e2] bg-white px-4 lg:justify-end lg:px-8"><div className="lg:hidden"><Brand/></div><button aria-label="Notifications" className="tap grid place-items-center rounded-xl text-[#60706c] hover:bg-[#f4f6f5]"><Bell size={20}/></button></header><main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main></div></div>; }
