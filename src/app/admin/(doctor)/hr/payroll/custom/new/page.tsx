"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/kit";
import { CustomPayslipEditor } from "@/components/hr/custom-payslip-editor";

/** A blank sheet — or, with `?copy=`, a copy of an existing one to start from. */
export default function NewCustomPayslipPage() {
  return <Suspense fallback={<Spinner label="Opening the editor…" />}>
    <Editor />
  </Suspense>;
}

function Editor() {
  const copy = useSearchParams().get("copy") ?? undefined;
  return <CustomPayslipEditor key={copy ?? "blank"} copyOf={copy} />;
}
