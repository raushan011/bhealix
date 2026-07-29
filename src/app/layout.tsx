import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "BHEALIX CRM", description: "Doctor relationship and field sales CRM" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
