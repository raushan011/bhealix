"use client";

import { useParams } from "next/navigation";
import { CustomPayslipEditor } from "@/components/hr/custom-payslip-editor";

export default function EditCustomPayslipPage() {
  const id = String(useParams().id ?? "");
  return <CustomPayslipEditor key={id} id={id} />;
}
