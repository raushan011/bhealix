import Link from "next/link";
import { SearchX } from "lucide-react";
export default function NotFound(){return <main className="grid min-h-screen place-items-center px-4 text-center"><div><SearchX className="mx-auto text-[#52716b]" size={36}/><h1 className="mt-4 text-xl font-semibold">Page not found</h1><p className="mt-1 text-sm text-[#697572]">The page may have moved.</p><Link href="/" className="tap mt-5 inline-flex items-center rounded-xl bg-[#173f3a] px-5 text-sm font-semibold text-white">Back home</Link></div></main>}
