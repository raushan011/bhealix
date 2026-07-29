import { z } from "zod";
export const radiusSchema=z.number().positive().max(100,"Radius cannot exceed 100 km");
export const timeSlotSchema=z.object({start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).refine(x=>x.end>x.start,{message:"End time must be after start time"});
export function normalizePhone(value:string){return value.replace(/[^\d+]/g,"").replace(/^00/,"+")}
