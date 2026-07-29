import { describe,expect,it } from "vitest";
import { doctorSearchSchema,externalDoctorToPayload } from "./search";

describe("doctor discovery",()=>{
  it("rejects a radius above 100 km",()=>expect(doctorSearchSchema.safeParse({doctorType:"Dermatologist",location:"Noida",radiusKm:101}).success).toBe(false));
  it("requires a valid skin doctor type",()=>expect(doctorSearchSchema.safeParse({doctorType:"Dentist",location:"Noida",radiusKm:10}).success).toBe(false));
  it("maps authorised place data without fabricating email",()=>expect(externalDoctorToPayload({id:"abc",displayName:{text:"Skin Clinic"},formattedAddress:"Noida",location:{latitude:28.5,longitude:77.3},distanceKm:2,category:"Dermatologist"})).not.toHaveProperty("email"));
});
