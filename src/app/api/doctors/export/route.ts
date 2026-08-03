import * as XLSX from "xlsx";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail } from "@/lib/api";
import { summariseCallSchedule } from "@/lib/doctors/call-schedule";
import { WEEKDAY_SHORT, toDisplayTime } from "@/lib/time";

type DoctorRow = {
  code: string; name: string; specialties?: string[]; clinicName?: string;
  phones?: string[]; email?: string; fullAddress?: string; area?: string; city?: string;
  location?: { coordinates?: number[] }; googleMapsUrl?: string; googlePlaceId?: string;
  rating?: number; reviewCount?: number; priority?: string; stage?: string; lastVisitedAt?: Date;
  callSchedule?: Array<{ weekday: number; slots: Array<{ start: string; end: string }>; appointmentRequired?: boolean; remarks?: string }>;
};

/**
 * Exports the directory in the same column shape the upload accepts, so a sheet
 * can be downloaded, edited offline and imported straight back.
 */
export async function GET() {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;
    await connectDb();

    const doctors = await Doctor.find({ status: "Active" })
      .select("code name specialties clinicName phones email fullAddress area city location googleMapsUrl googlePlaceId rating reviewCount priority stage callSchedule lastVisitedAt")
      .sort({ city: 1, name: 1 }).limit(10000).lean() as unknown as DoctorRow[];

    const rows = doctors.map(doctor => ({
      "Doctor Code": doctor.code,
      "Doctor Name": doctor.name,
      "Doctor Type": doctor.specialties?.join(", ") ?? "",
      "Clinic": doctor.clinicName ?? "",
      "Mobile": doctor.phones?.[0] ?? "",
      "Email": doctor.email ?? "",
      "Address": doctor.fullAddress ?? "",
      "Area": doctor.area ?? "",
      "City": doctor.city ?? "",
      "Latitude": doctor.location?.coordinates?.[1] ?? "",
      "Longitude": doctor.location?.coordinates?.[0] ?? "",
      "MR Call Time": summariseCallSchedule(doctor.callSchedule as never),
      "Call Days": (doctor.callSchedule ?? []).map(w => WEEKDAY_SHORT[w.weekday]).join(", "),
      "Call Slots": (doctor.callSchedule ?? []).map(w =>
        `${WEEKDAY_SHORT[w.weekday]} ${w.slots.map(s => `${toDisplayTime(s.start)}-${toDisplayTime(s.end)}`).join(" & ")}`).join(" | "),
      "Appointment Required": (doctor.callSchedule ?? []).some(w => w.appointmentRequired) ? "Yes" : "No",
      "Priority": doctor.priority ?? "",
      "Stage": doctor.stage ?? "",
      "Rating": doctor.rating ?? "",
      "Reviews": doctor.reviewCount ?? "",
      "Last Visited": doctor.lastVisitedAt ? new Date(doctor.lastVisitedAt).toLocaleDateString("en-IN") : "",
      "Google Maps": doctor.googleMapsUrl ?? "",
      "Place ID": doctor.googlePlaceId ?? ""
    }));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Doctors");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename=bhealix-doctors-${new Date().toISOString().slice(0, 10)}.xlsx`
      }
    });
  } catch (error) {
    return fail(error);
  }
}
