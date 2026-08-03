import { describe,expect,it } from "vitest";
import { doctorSearchSchema,excelRowToExternalDoctor,externalDoctorToPayload } from "./search";

describe("doctor discovery",()=>{
  it("rejects a radius above 100 km",()=>expect(doctorSearchSchema.safeParse({doctorType:"Dermatologist",location:"Noida",radiusKm:101}).success).toBe(false));
  it("requires a valid skin doctor type",()=>expect(doctorSearchSchema.safeParse({doctorType:"Dentist",location:"Noida",radiusKm:10}).success).toBe(false));
  it("maps authorised place data without fabricating email",()=>expect(externalDoctorToPayload({id:"abc",displayName:{text:"Skin Clinic"},formattedAddress:"Noida",location:{latitude:28.5,longitude:77.3},distanceKm:2,category:"Dermatologist"})).not.toHaveProperty("email"));

  it("parses an uploaded sheet row back into a selectable result, preserving coordinates",()=>{
    const row=excelRowToExternalDoctor({"Doctor or Clinic":"Dr. Rao","Type":"Dermatologist",Address:"Sector 62, Noida",Mobile:"9999999999",Email:"dr.rao@example.com",Latitude:"28.62",Longitude:"77.37","Place ID":""},"file-0");
    expect(row.displayName?.text).toBe("Dr. Rao");
    expect(row.location).toEqual({latitude:28.62,longitude:77.37});
    expect(row.fromFile).toBe(true);
    expect(externalDoctorToPayload(row)).not.toHaveProperty("googlePlaceId");
  });
});
